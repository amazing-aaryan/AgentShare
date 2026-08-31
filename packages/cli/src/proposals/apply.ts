import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  decryptEnvironmentObject,
  encryptEnvironmentObject,
  keyFromFragment,
} from "@agentshare/acb";
import {
  MAX_CIPHERTEXT_BYTES,
  MAX_RESOURCE_BYTES,
  proposalSchema,
  type AgentShareProposal,
  type ProposalOperation,
} from "@agentshare/contracts";
import {
  assertSafeResourcePath,
  classifyResourceContent,
  sanitizeResourcePath,
  scanAndRedact,
  scanText,
} from "@agentshare/scanner";
import { readOwnedSnapshot } from "../environment/owned-snapshot.js";
import {
  ensurePrivateDirectory,
  securePrivatePath,
} from "../environment/private-store.js";
import {
  prepareCapturedSnapshot,
  verifyPreparedCapture,
  type PreparedCapture,
} from "../environment/preview.js";
import {
  publishEnvironmentRevision,
  resumePendingRevision,
  type HostCapture,
  type PublicationSummary,
} from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import {
  defaultEnvironmentStatePath,
  findOwnedEnvironment,
  loadEnvironmentState,
  removeTransaction,
  saveTransaction,
  withEnvironmentLock,
  type OwnedEnvironment,
} from "../environment/state.js";
import {
  excludedByPolicy,
  normalizedWorkspacePath,
} from "../workspace/policy.js";
import { listOwnedProposals } from "./inbox.js";

const execFileAsync = promisify(execFile);
export type ApproveProposalResult = {
  environment: OwnedEnvironment;
  summary: PublicationSummary;
};
export type ProposalOptions = {
  client?: EnvironmentRelayClient;
  statePath?: string;
  now?: () => Date;
  workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  reviewDigest?: string;
};
export type PreparedProposalReview = {
  proposal: AgentShareProposal;
  base: PreparedCapture;
  preparedCapture: PreparedCapture;
  digest: string;
};
type JournalEntry = {
  operation: ProposalOperation;
  before: { contentBase64: string; mode: number } | null;
  status: "pending" | "writing" | "applied" | "rolled-back";
};
type ApplyJournal = {
  version: 2;
  proposal: AgentShareProposal;
  workspaceRoot: string;
  phase:
    | "prepared"
    | "applying"
    | "applied-local"
    | "publishing"
    | "published"
    | "rollback-needed";
  entries: JournalEntry[];
  preparedCapture: PreparedCapture;
  reviewDigest: string;
  outgoingRevisionId?: string;
};

/** Preview only authenticated shared bytes. Raw owner files are checked, not returned. */
export async function prepareOwnedProposalReview(
  environmentId: string,
  proposalId: string,
  options: ProposalOptions = {},
): Promise<PreparedProposalReview> {
  return withEnvironmentLock(environmentId, options.statePath, async () => {
    const owned = await requireOwned(environmentId, options.statePath);
    const client = ownedClient(owned, options.client);
    const item = await requireProposal(
      owned,
      proposalId,
      client,
      options.statePath,
    );
    if (item.status !== "pending")
      throw new Error(`Proposal is already ${item.status}`);
    await assertNoTransaction(owned, options.statePath);
    return (await prepareReview(owned, item.proposal, client, options)).review;
  });
}

/** The legacy capture argument is intentionally ignored: approval never recaptures. */
export async function approveOwnedProposal(
  environmentId: string,
  proposalId: string,
  _capture?: HostCapture,
  options: ProposalOptions = {},
): Promise<ApproveProposalResult> {
  return withEnvironmentLock(environmentId, options.statePath, async () => {
    let owned = await requireOwned(environmentId, options.statePath);
    const client = ownedClient(owned, options.client);
    const item = await requireProposal(
      owned,
      proposalId,
      client,
      options.statePath,
    );
    const path = transactionJournalPath(proposalId, options.statePath);
    const legacyPath = join(
      dirname(options.statePath ?? defaultEnvironmentStatePath()),
      "transactions",
      `${proposalId}.enc`,
    );
    if (await exists(legacyPath)) {
      await ensurePrivateDirectory(dirname(legacyPath));
      await securePrivatePath(legacyPath);
      throw new Error(
        "Legacy proposal journal requires manual recovery before approval",
      );
    }
    let journal = await readJournal(owned, item.proposal, path);
    if (journal !== undefined) {
      if (["prepared", "applying", "rollback-needed"].includes(journal.phase)) {
        await rollbackJournal(owned, journal, path);
        await clearJournal(proposalId, path, options.statePath);
        throw new Error(
          "Interrupted local apply rolled back; review proposal again",
        );
      }
      return publishJournal(owned, journal, client, path, options);
    }
    if (item.status !== "pending")
      throw new Error(`Proposal is already ${item.status}`);
    await assertNoTransaction(owned, options.statePath);
    const prepared = await prepareReview(owned, item.proposal, client, options);
    if (
      options.reviewDigest !== undefined &&
      options.reviewDigest !== prepared.review.digest
    ) {
      throw new Error("Proposal review changed; review again before approval");
    }
    const metadata = await client.metadata(environmentId, owned.readCapability);
    if (metadata.currentRevisionId !== item.proposal.baseRevisionId) {
      throw new Error("Proposal conflict: remote base changed before apply");
    }
    journal = prepared.journal;
    await writeJournal(owned, journal, path);
    await recordTransaction(journal, "prepared", options);
    try {
      journal.phase = "applying";
      await writeJournal(owned, journal, path);
      for (const entry of journal.entries) {
        await assertCurrentBefore(
          journal.workspaceRoot,
          entry,
          maxFileBytes(options),
        );
        entry.status = "writing";
        await writeJournal(owned, journal, path);
        await applyEntry(journal.workspaceRoot, entry, maxFileBytes(options));
        entry.status = "applied";
        await writeJournal(owned, journal, path);
      }
      journal.phase = "applied-local";
      await writeJournal(owned, journal, path);
      await recordTransaction(journal, "applied-local", options);
    } catch (error) {
      journal.phase = "rollback-needed";
      await writeJournal(owned, journal, path);
      try {
        await rollbackJournal(owned, journal, path);
        await clearJournal(proposalId, path, options.statePath);
      } catch {
        throw new Error(
          "Proposal apply failed; rollback preserved conflicting local edits. Recover transaction before retrying.",
          { cause: error },
        );
      }
      throw error;
    }
    // saveTransaction changes global state generation, not the owned generation.
    owned = await requireOwned(environmentId, options.statePath);
    return publishJournal(owned, journal, client, path, options);
  });
}

export async function rejectOwnedProposal(
  environmentId: string,
  proposalId: string,
  options: { client?: EnvironmentRelayClient; statePath?: string } = {},
): Promise<void> {
  return withEnvironmentLock(environmentId, options.statePath, async () => {
    const owned = await requireOwned(environmentId, options.statePath);
    const client = ownedClient(owned, options.client);
    await assertNoTransaction(owned, options.statePath);
    await client.setProposalStatus(
      environmentId,
      proposalId,
      owned.inboxCapability,
      "rejected",
    );
  });
}

async function prepareReview(
  owned: OwnedEnvironment,
  proposal: AgentShareProposal,
  client: EnvironmentRelayClient,
  options: ProposalOptions,
): Promise<{ review: PreparedProposalReview; journal: ApplyJournal }> {
  if (owned.currentRevisionId !== proposal.baseRevisionId)
    throw new Error("Proposal conflict: base revision is no longer current");
  if (
    !owned.sharePolicy.proposalsEnabled ||
    !owned.sharePolicy.includeWorkspace
  )
    throw new Error("Environment does not permit workspace proposals");
  if (scanText(proposal.summary).findings.length > 0)
    throw new Error("Proposal summary contains a suspected secret");
  const base = await readOwnedSnapshot(owned, client);
  const root = await realpath(owned.workspaceRoot);
  const limit = maxFileBytes(options);
  const ignored = await ignoreMatcher(root);
  const git = await isGitWorkspace(root);
  const files = new Map(
    base.snapshot.files.map((file) => [file.path, { ...file }]),
  );
  const entries: JournalEntry[] = [];
  const seen = new Set<string>();
  let journalBytes = 0;
  let proposedBytes = 0;
  for (const operation of proposal.operations) {
    const path = safePath(operation.path);
    const alias = path.toLowerCase();
    if (seen.has(alias)) throw new Error("Proposal contains colliding paths");
    seen.add(alias);
    if (
      alias
        .split("/")
        .some(
          (_part, index, parts) =>
            excludedByPolicy(parts.slice(0, index + 1).join("/")) !== undefined,
        ) ||
      ignored(path) ||
      (git && (await isGitIgnored(root, path)))
    ) {
      throw new Error(
        `Proposal path is excluded: ${sanitizeResourcePath(path)}`,
      );
    }
    await assertParentsSafe(root, path);
    const shared = files.get(path);
    if (operation.type === "create") {
      if (
        shared !== undefined ||
        [...files.keys()].some(
          (other) =>
            other.toLowerCase() === alias ||
            other.toLowerCase().startsWith(`${alias}/`) ||
            alias.startsWith(`${other.toLowerCase()}/`),
        )
      ) {
        throw new Error(
          `Proposal create conflicts with shared membership: ${sanitizeResourcePath(path)}`,
        );
      }
    } else if (shared?.sha256 !== operation.baseSha256) {
      throw new Error(
        `Proposal path/base hash is not in approved snapshot: ${sanitizeResourcePath(path)}`,
      );
    }
    let before: JournalEntry["before"] = null;
    const target = targetPath(root, path);
    if (operation.type === "create") {
      if (await exists(target))
        throw new Error(
          `Proposal conflict: create target already exists: ${sanitizeResourcePath(path)}`,
        );
    } else {
      const raw = await readRawFile(target, limit);
      if (sha256(raw.bytes) !== operation.baseSha256)
        throw new Error(
          `Proposal conflict: raw base hash changed for ${sanitizeResourcePath(path)}`,
        );
      journalBytes += raw.bytes.byteLength;
      if (journalBytes > MAX_CIPHERTEXT_BYTES)
        throw new Error("Proposal rollback data exceeds size limit");
      before = { contentBase64: raw.bytes.toString("base64"), mode: raw.mode };
    }
    entries.push({ operation, before, status: "pending" });
    if (operation.type === "delete") files.delete(path);
    else {
      const content = verifiedNewContent(operation, limit);
      proposedBytes += content.byteLength;
      if (proposedBytes > MAX_CIPHERTEXT_BYTES)
        throw new Error("Proposal content exceeds size limit");
      rejectSecrets(path, operation.mediaType, content);
      files.set(path, {
        path,
        mediaType: operation.mediaType,
        byteLength: content.length,
        sha256: operation.newSha256,
        executable: shared?.executable ?? false,
        contentBase64: content.toString("base64"),
      });
    }
  }
  for (const path of seen) {
    if (
      [...seen].some((other) => other !== path && other.startsWith(`${path}/`))
    )
      throw new Error("Proposal contains overlapping paths");
  }
  const snapshot = {
    ...base.snapshot,
    files: [...files.values()],
    totalBytes: [...files.values()].reduce(
      (sum, file) => sum + file.byteLength,
      0,
    ),
  };
  if (snapshot.totalBytes > MAX_CIPHERTEXT_BYTES)
    throw new Error("Proposed workspace exceeds size limit");
  const preparedCapture = prepareCapturedSnapshot(base.capture, snapshot, {
    includeConversation: owned.sharePolicy.includeConversation,
    proposalsEnabled: owned.sharePolicy.proposalsEnabled,
  });
  if (preparedCapture.findings.length > 0)
    throw new Error("Proposal outbound snapshot contains a suspected secret");
  const digest = sha256(
    Buffer.from(
      JSON.stringify({
        proposal,
        base: base.digest,
        outbound: preparedCapture.digest,
        generation: owned.generation ?? 0,
      }),
    ),
  );
  return {
    review: { proposal, base, preparedCapture, digest },
    journal: {
      version: 2,
      proposal,
      workspaceRoot: root,
      phase: "prepared",
      entries,
      preparedCapture,
      reviewDigest: digest,
    },
  };
}

async function publishJournal(
  owned: OwnedEnvironment,
  journal: ApplyJournal,
  client: EnvironmentRelayClient,
  path: string,
  options: ProposalOptions,
): Promise<ApproveProposalResult> {
  verifyPreparedCapture(journal.preparedCapture);
  const pending = owned.pendingRevision;
  let published: ApproveProposalResult;
  if (pending !== undefined) {
    if (
      pending.proposalId !== journal.proposal.proposalId ||
      pending.reservation.parentRevisionId !==
        journal.proposal.baseRevisionId ||
      (journal.outgoingRevisionId !== undefined &&
        journal.outgoingRevisionId !== pending.reservation.revisionId)
    ) {
      throw new Error(
        "Another publication is pending; cannot recover this proposal",
      );
    }
    journal.outgoingRevisionId = pending.reservation.revisionId;
    journal.phase = "publishing";
    await writeJournal(owned, journal, path);
    published = {
      environment: await resumePendingRevision(
        owned,
        client,
        options.statePath,
        journal.outgoingRevisionId,
      ),
      summary: journal.preparedCapture.summary,
    };
  } else if (
    journal.outgoingRevisionId !== undefined &&
    owned.currentRevisionId === journal.outgoingRevisionId
  ) {
    const metadata = await client.metadata(
      owned.environmentId,
      owned.readCapability,
    );
    if (metadata.currentRevisionId !== journal.outgoingRevisionId)
      throw new Error("Recovered proposal revision changed");
    await client.setProposalStatus(
      owned.environmentId,
      journal.proposal.proposalId,
      owned.inboxCapability,
      "accepted",
    );
    published = {
      environment: owned,
      summary: journal.preparedCapture.summary,
    };
  } else {
    if (
      owned.currentRevisionId !== journal.proposal.baseRevisionId ||
      journal.outgoingRevisionId !== undefined
    )
      throw new Error("Proposal base changed; recovery requires review");
    const metadata = await client.metadata(
      owned.environmentId,
      owned.readCapability,
    );
    if (metadata.currentRevisionId !== journal.proposal.baseRevisionId)
      throw new Error("Proposal remote base changed; recovery requires review");
    published = await publishEnvironmentRevision(
      journal.preparedCapture.capture,
      owned,
      client,
      {
        ...(options.statePath === undefined
          ? {}
          : { statePath: options.statePath }),
        now: (options.now ?? (() => new Date()))(),
        proposalId: journal.proposal.proposalId,
        preparedCapture: journal.preparedCapture,
        onPreparedRevision: async (_environmentId, revisionId) => {
          journal.outgoingRevisionId = revisionId;
          journal.phase = "publishing";
          await writeJournal(owned, journal, path);
        },
      },
    );
  }
  journal.phase = "published";
  await writeJournal(published.environment, journal, path);
  await recordTransaction(journal, "published", options);
  await clearJournal(journal.proposal.proposalId, path, options.statePath);
  return published;
}

async function applyEntry(
  root: string,
  entry: JournalEntry,
  limit: number,
): Promise<void> {
  const operation = entry.operation;
  const target = targetPath(root, operation.path);
  await assertParentsSafe(root, operation.path);
  if (operation.type === "delete") {
    await assertCurrentBefore(root, entry, limit);
    await rm(target);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await assertParentsSafe(root, operation.path);
  const temporary = `${target}.agentshare-${randomUUID()}.tmp`;
  const mode = entry.before?.mode ?? 0o644;
  await writeFile(temporary, verifiedNewContent(operation, limit), {
    flag: "wx",
    mode,
  });
  try {
    await chmod(temporary, mode).catch(() => undefined);
    await assertCurrentBefore(root, entry, limit);
    if (operation.type === "create") await link(temporary, target);
    else await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function assertCurrentBefore(
  root: string,
  entry: JournalEntry,
  limit: number,
): Promise<void> {
  await assertParentsSafe(root, entry.operation.path);
  const target = targetPath(root, entry.operation.path);
  if (entry.before === null) {
    if (await exists(target))
      throw new Error(
        `Proposal conflict: create target already exists: ${sanitizeResourcePath(entry.operation.path)}`,
      );
  } else {
    const raw = await readRawFile(target, limit);
    if (
      sha256(raw.bytes) !==
        sha256(Buffer.from(entry.before.contentBase64, "base64")) ||
      raw.mode !== entry.before.mode
    ) {
      throw new Error(
        `Proposal conflict: target changed before apply: ${sanitizeResourcePath(entry.operation.path)}`,
      );
    }
  }
}

async function rollbackJournal(
  owned: OwnedEnvironment,
  journal: ApplyJournal,
  path: string,
): Promise<void> {
  for (const entry of [...journal.entries].reverse()) {
    if (entry.status === "pending" || entry.status === "rolled-back") continue;
    const name = entry.operation.path;
    await assertParentsSafe(journal.workspaceRoot, name);
    const target = targetPath(journal.workspaceRoot, name);
    const current = (await exists(target))
      ? await readRawFile(target, MAX_RESOURCE_BYTES)
      : undefined;
    const original =
      entry.before === null
        ? undefined
        : Buffer.from(entry.before.contentBase64, "base64");
    const unchanged =
      original === undefined
        ? current === undefined
        : current !== undefined &&
          sha256(current.bytes) === sha256(original) &&
          current.mode === entry.before?.mode;
    if (!unchanged) {
      const matchesWritten =
        entry.operation.type === "delete"
          ? current === undefined
          : current !== undefined &&
            sha256(current.bytes) === entry.operation.newSha256 &&
            current.mode ===
              (entry.before?.mode ??
                (process.platform === "win32" ? 0o666 : 0o644));
      if (!matchesWritten)
        throw new Error(
          `Rollback preserved concurrent edit: ${sanitizeResourcePath(name)}`,
        );
      if (entry.before === null) await rm(target);
      else {
        const temporary = `${target}.agentshare-rollback-${randomUUID()}.tmp`;
        await writeFile(temporary, original ?? Buffer.alloc(0), {
          flag: "wx",
          mode: entry.before.mode,
        });
        try {
          await chmod(temporary, entry.before.mode).catch(() => undefined);
          await assertParentsSafe(journal.workspaceRoot, name);
          const latest = (await exists(target))
            ? await readRawFile(target, MAX_RESOURCE_BYTES)
            : undefined;
          if (entry.operation.type === "delete") {
            if (latest !== undefined)
              throw new Error(
                `Rollback preserved concurrent edit: ${sanitizeResourcePath(name)}`,
              );
            await link(temporary, target);
          } else {
            if (
              latest === undefined ||
              sha256(latest.bytes) !== entry.operation.newSha256 ||
              latest.mode !== entry.before.mode
            )
              throw new Error(
                `Rollback preserved concurrent edit: ${sanitizeResourcePath(name)}`,
              );
            await rename(temporary, target);
          }
        } finally {
          await rm(temporary, { force: true });
        }
      }
    }
    entry.status = "rolled-back";
    await writeJournal(owned, journal, path);
  }
}

async function writeJournal(
  owned: OwnedEnvironment,
  journal: ApplyJournal,
  path: string,
): Promise<void> {
  const encrypted = encryptEnvironmentObject(
    Buffer.from(JSON.stringify(journal)),
    keyFromFragment(owned.environmentMasterKey),
    journalContext(journal.proposal),
  );
  // New temporary files inherit the enforced owner-only Windows directory ACL.
  // POSIX additionally uses mode 0600; existing files are hardened before reads.
  await ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, encrypted.envelope, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readJournal(
  owned: OwnedEnvironment,
  proposal: AgentShareProposal,
  path: string,
): Promise<ApplyJournal | undefined> {
  let bytes: Buffer;
  try {
    await ensurePrivateDirectory(dirname(dirname(path)));
    await ensurePrivateDirectory(dirname(path));
    if (!(await exists(path))) return undefined;
    await securePrivatePath(path);
    bytes = await readFile(path);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(
    Buffer.from(
      decryptEnvironmentObject(
        bytes,
        keyFromFragment(owned.environmentMasterKey),
        journalContext(proposal),
      ),
    ).toString("utf8"),
  );
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    !isRecord(value.proposal) ||
    JSON.stringify(value.proposal) !== JSON.stringify(proposal) ||
    typeof value.workspaceRoot !== "string" ||
    value.workspaceRoot !== (await realpath(owned.workspaceRoot)) ||
    typeof value.reviewDigest !== "string" ||
    ![
      "prepared",
      "applying",
      "applied-local",
      "publishing",
      "published",
      "rollback-needed",
    ].includes(String(value.phase)) ||
    !Array.isArray(value.entries) ||
    value.entries.length !== proposal.operations.length ||
    !value.entries.every(
      (entry, index) =>
        isRecord(entry) &&
        JSON.stringify(entry.operation) ===
          JSON.stringify(proposal.operations[index]) &&
        ["pending", "writing", "applied", "rolled-back"].includes(
          String(entry.status),
        ) &&
        (entry.before === null ||
          (isRecord(entry.before) &&
            typeof entry.before.contentBase64 === "string" &&
            typeof entry.before.mode === "number" &&
            Number.isInteger(entry.before.mode) &&
            entry.before.mode >= 0 &&
            entry.before.mode <= 0o777)),
    ) ||
    !isRecord(value.preparedCapture) ||
    (value.outgoingRevisionId !== undefined &&
      typeof value.outgoingRevisionId !== "string")
  ) {
    throw new Error(
      "Invalid or legacy AgentShare apply journal; manual recovery required",
    );
  }
  const journal = value as ApplyJournal;
  verifyPreparedCapture(journal.preparedCapture);
  for (const entry of journal.entries) safePath(entry.operation.path);
  return journal;
}

function journalContext(proposal: AgentShareProposal) {
  return {
    environmentId: proposal.environmentId,
    revisionId: proposal.baseRevisionId,
    kind: "index" as const,
    objectId: `transaction_${proposal.proposalId}`,
  };
}
async function recordTransaction(
  journal: ApplyJournal,
  status: "prepared" | "applied-local" | "published",
  options: ProposalOptions,
): Promise<void> {
  await saveTransaction(
    {
      proposalId: journal.proposal.proposalId,
      environmentId: journal.proposal.environmentId,
      workspaceRoot: journal.workspaceRoot,
      status,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    },
    options.statePath,
  );
}
async function clearJournal(
  proposalId: string,
  path: string,
  statePath?: string,
): Promise<void> {
  await removeTransaction(proposalId, statePath);
  await rm(path, { force: true });
}
async function assertNoTransaction(
  owned: OwnedEnvironment,
  statePath?: string,
): Promise<void> {
  if (
    owned.pendingRevision !== undefined ||
    (await loadEnvironmentState(statePath)).transactions.some(
      (entry) => entry.environmentId === owned.environmentId,
    )
  )
    throw new Error(
      "Environment transaction pending; recover before reviewing another proposal",
    );
}
async function requireOwned(
  environmentId: string,
  statePath?: string,
): Promise<OwnedEnvironment> {
  const owned = await findOwnedEnvironment(environmentId, statePath);
  if (owned === undefined)
    throw new Error("AgentShare environment is not owned locally");
  return owned;
}
function ownedClient(
  owned: OwnedEnvironment,
  client?: EnvironmentRelayClient,
): EnvironmentRelayClient {
  const result = client ?? new EnvironmentRelayClient(owned.relayOrigin);
  if (result.origin !== owned.relayOrigin)
    throw new Error("Proposal relay does not match owned environment");
  return result;
}
async function requireProposal(
  owned: OwnedEnvironment,
  proposalId: string,
  client: EnvironmentRelayClient,
  statePath?: string,
) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{19,99}$/u.test(proposalId))
    throw new Error("Invalid proposal ID");
  const item = (
    await listOwnedProposals(owned.environmentId, {
      client,
      ...(statePath === undefined ? {} : { statePath }),
    })
  ).find((candidate) => candidate.proposal.proposalId === proposalId);
  if (item === undefined) throw new Error("Proposal not found");
  const proposal = proposalSchema.parse(item.proposal);
  if (proposal.environmentId !== owned.environmentId)
    throw new Error("Proposal environment mismatch");
  return { ...item, proposal };
}
function safePath(path: string): string {
  assertSafeResourcePath(path);
  if (
    normalizedWorkspacePath(path) !== path ||
    path
      .split("/")
      .some(
        (part) =>
          /[<>:"|?*\p{Cc}\p{Cf}]/u.test(part) ||
          /[. ]$/u.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  )
    throw new Error(`Unsafe proposal path: ${sanitizeResourcePath(path)}`);
  return path;
}
function targetPath(root: string, path: string): string {
  const target = resolve(root, ...safePath(path).split("/"));
  const rel = relative(root, target);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rel)
  )
    throw new Error("Proposal path escapes workspace root");
  return target;
}
async function assertParentsSafe(root: string, path: string): Promise<void> {
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("Proposal workspace root is no longer a safe directory");
  }
  const parts = safePath(path).split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = targetPath(root, parts.slice(0, index).join("/"));
    try {
      const metadata = await lstat(candidate);
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new Error(
          `Unsafe proposal parent: ${sanitizeResourcePath(path)}`,
        );
      const actual = relative(root, await realpath(candidate));
      if (actual.startsWith("..") || isAbsolute(actual))
        throw new Error("Proposal parent escapes workspace root");
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}
async function readRawFile(
  path: string,
  limit: number,
): Promise<{ bytes: Buffer; mode: number }> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > limit)
    throw new Error("Proposal target is not a bounded regular file");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (
      opened.ino !== metadata.ino ||
      opened.dev !== metadata.dev ||
      opened.size > limit
    )
      throw new Error("Proposal target changed while reading");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > limit || length !== metadata.size)
      throw new Error("Proposal target changed size while reading");
    return { bytes: bytes.subarray(0, length), mode: metadata.mode & 0o777 };
  } finally {
    await handle.close();
  }
}
function verifiedNewContent(
  operation: Extract<ProposalOperation, { type: "create" | "replace" }>,
  limit: number,
): Buffer {
  if (operation.contentBase64.length > Math.ceil(limit / 3) * 4)
    throw new Error("Proposal file exceeds size limit");
  const content = Buffer.from(operation.contentBase64, "base64");
  if (
    content.length > limit ||
    content.toString("base64") !== operation.contentBase64 ||
    sha256(content) !== operation.newSha256
  )
    throw new Error(
      `Proposal new-content integrity mismatch: ${sanitizeResourcePath(operation.path)}`,
    );
  return content;
}
function rejectSecrets(path: string, mediaType: string, content: Buffer): void {
  const scan = scanAndRedact({
    version: "acb-v1",
    title: "proposal-scan",
    sourceAgent: "generic",
    exportedAt: new Date(0).toISOString(),
    events: [],
    resources: [
      {
        id: "proposal-resource",
        mediaType,
        byteLength: content.length,
        sha256: sha256(content),
        contentBase64: content.toString("base64"),
        sourcePath: path,
      },
    ],
  });
  if (scan.findings.length > 0)
    throw new Error(
      `Proposal contains a suspected secret in ${sanitizeResourcePath(path)}`,
    );
}
async function ignoreMatcher(root: string): Promise<(path: string) => boolean> {
  let content: string;
  try {
    const bytes = (
      await readRawFile(join(root, ".agentshareignore"), MAX_RESOURCE_BYTES)
    ).bytes;
    const classified = classifyResourceContent("text/plain", bytes);
    if (classified.kind === "binary")
      throw new Error("Cannot verify non-UTF-8 AgentShare ignore policy");
    content = classified.text;
  } catch (error) {
    if (isNotFound(error)) return () => false;
    throw error;
  }
  const rules = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) => line !== "" && !line.startsWith("#") && !line.startsWith("!"),
    )
    .map((line) => {
      const pattern = normalizedWorkspacePath(
        line.replace(/^\//u, "").replace(/\/$/u, ""),
      );
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*\*/gu, "§§DOUBLESTAR§§")
        .replace(/\*/gu, "[^/]*")
        .replace(/§§DOUBLESTAR§§/gu, ".*")
        .replace(/\?/gu, "[^/]");
      return new RegExp(
        `${pattern.includes("/") ? "^" : "(?:^|/)"}${escaped}(?:/.*)?$`,
        "u",
      );
    });
  return (path) => rules.some((rule) => rule.test(path));
}
async function isGitWorkspace(root: string): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--is-inside-work-tree"],
      { windowsHide: true, timeout: 10_000 },
    );
    return true;
  } catch (error) {
    if (isRecord(error) && (error.code === 128 || error.code === "ENOENT"))
      return false;
    throw new Error("Cannot verify Git ignore policy", { cause: error });
  }
}
async function isGitIgnored(root: string, path: string): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", root, "check-ignore", "--no-index", "-q", "--", path],
      { windowsHide: true, timeout: 10_000 },
    );
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === 1) return false;
    throw new Error("Cannot verify Git ignore policy", { cause: error });
  }
}
function maxFileBytes(options: ProposalOptions): number {
  const value = options.workspaceOptions?.maxFileBytes ?? MAX_RESOURCE_BYTES;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid proposal size limit");
  return Math.min(value, MAX_RESOURCE_BYTES);
}
function transactionJournalPath(
  proposalId: string,
  statePath = defaultEnvironmentStatePath(),
): string {
  return join(
    dirname(statePath),
    ".agentshare-private",
    "transactions",
    `${proposalId}.enc`,
  );
}
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
