import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  decryptEnvironmentObject,
  encryptEnvironmentObject,
  keyFromFragment,
} from "@agentshare/acb";
import {
  type AgentShareProposal,
  type ProposalOperation,
} from "@agentshare/contracts";
import { scanAndRedact } from "@agentshare/scanner";
import {
  publishEnvironmentRevision,
  type HostCapture,
  type PublicationSummary,
} from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import {
  defaultEnvironmentStatePath,
  findOwnedEnvironment,
  removeTransaction,
  saveTransaction,
  type OwnedEnvironment,
} from "../environment/state.js";
import { normalizedWorkspacePath } from "../workspace/policy.js";
import { listOwnedProposals } from "./inbox.js";

export type ApproveProposalResult = {
  environment: OwnedEnvironment;
  summary: PublicationSummary;
};

type JournalEntry =
  | {
      type: "create";
      path: string;
    }
  | {
      type: "restore";
      path: string;
      contentBase64: string;
      mode: number;
    };

type ApplyJournal = {
  version: 1;
  proposalId: string;
  environmentId: string;
  entries: JournalEntry[];
};

export async function approveOwnedProposal(
  environmentId: string,
  proposalId: string,
  capture: HostCapture,
  options: {
    client?: EnvironmentRelayClient;
    statePath?: string;
    now?: () => Date;
    workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  } = {},
): Promise<ApproveProposalResult> {
  let owned = await findOwnedEnvironment(environmentId, options.statePath);
  if (owned === undefined) {
    throw new Error(
      `AgentShare environment is not owned locally: ${environmentId}`,
    );
  }
  const client =
    options.client ?? new EnvironmentRelayClient(owned.relayOrigin);
  const inbox = await listOwnedProposals(environmentId, {
    client,
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
  });
  const item = inbox.find(
    (candidate) => candidate.proposal.proposalId === proposalId,
  );
  if (item === undefined) throw new Error(`Proposal not found: ${proposalId}`);
  if (item.status !== "pending") {
    throw new Error(`Proposal is already ${item.status}`);
  }
  const proposal = item.proposal;
  if (owned.currentRevisionId !== proposal.baseRevisionId) {
    throw new Error(
      `Proposal conflict: base revision ${proposal.baseRevisionId} is no longer current`,
    );
  }
  const actualWorkspace = await realpath(owned.workspaceRoot);
  const captureWorkspace = await realpath(capture.workspaceRoot);
  if (actualWorkspace !== captureWorkspace) {
    throw new Error("Proposal approval capture does not match owned workspace");
  }

  const prepared = await preflightProposal(actualWorkspace, proposal);
  const journalPath = transactionJournalPath(
    proposal.proposalId,
    options.statePath,
  );
  await writeJournal(owned, proposal, prepared.journal, journalPath);
  await saveTransaction(
    {
      proposalId: proposal.proposalId,
      environmentId,
      workspaceRoot: actualWorkspace,
      status: "prepared",
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    },
    options.statePath,
  );

  try {
    await applyOperations(actualWorkspace, proposal.operations);
  } catch (error) {
    try {
      await rollbackJournal(owned, proposal, journalPath);
      await rm(journalPath, { force: true });
      await removeTransaction(proposal.proposalId, options.statePath);
    } catch (rollbackError) {
      throw new Error(
        `Proposal apply failed and rollback also failed: ${displayError(error)}; rollback: ${displayError(rollbackError)}`,
      );
    }
    throw error;
  }

  await saveTransaction(
    {
      proposalId: proposal.proposalId,
      environmentId,
      workspaceRoot: actualWorkspace,
      status: "applied-local",
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    },
    options.statePath,
  );

  const published = await publishEnvironmentRevision(capture, owned, client, {
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
    now: (options.now ?? (() => new Date()))(),
    proposalId: proposal.proposalId,
    ...(options.workspaceOptions === undefined
      ? {}
      : { workspaceOptions: options.workspaceOptions }),
  });
  owned = published.environment;
  await rm(journalPath, { force: true });
  await removeTransaction(proposal.proposalId, options.statePath);
  return { environment: owned, summary: published.summary };
}

export async function rejectOwnedProposal(
  environmentId: string,
  proposalId: string,
  options: { client?: EnvironmentRelayClient; statePath?: string } = {},
): Promise<void> {
  const owned = await findOwnedEnvironment(environmentId, options.statePath);
  if (owned === undefined) {
    throw new Error(
      `AgentShare environment is not owned locally: ${environmentId}`,
    );
  }
  const client =
    options.client ?? new EnvironmentRelayClient(owned.relayOrigin);
  await client.setProposalStatus(
    environmentId,
    proposalId,
    owned.inboxCapability,
    "rejected",
  );
}

async function preflightProposal(
  root: string,
  proposal: AgentShareProposal,
): Promise<{ journal: ApplyJournal }> {
  const journal: ApplyJournal = {
    version: 1,
    proposalId: proposal.proposalId,
    environmentId: proposal.environmentId,
    entries: [],
  };
  for (const operation of proposal.operations) {
    const path = normalizedWorkspacePath(operation.path);
    if (path !== operation.path) {
      throw new Error(`Proposal path is not canonical: ${operation.path}`);
    }
    const target = resolve(root, ...path.split("/"));
    assertInside(root, target);
    await assertParentsSafe(root, path);
    if (operation.type === "create") {
      if (await exists(target)) {
        throw new Error(
          `Proposal conflict: create target already exists: ${path}`,
        );
      }
      const content = verifiedNewContent(operation);
      rejectSecrets(path, operation.mediaType, content);
      journal.entries.push({ type: "create", path });
      continue;
    }

    const metadata = await lstat(target).catch((error: unknown) => {
      if (isNotFound(error)) {
        throw new Error(`Proposal conflict: target no longer exists: ${path}`);
      }
      throw error;
    });
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Proposal target is not a regular file: ${path}`);
    }
    const original = await readFile(target);
    if (sha256(original) !== operation.baseSha256) {
      throw new Error(`Proposal conflict: base hash changed for ${path}`);
    }
    journal.entries.push({
      type: "restore",
      path,
      contentBase64: original.toString("base64"),
      mode: metadata.mode & 0o777,
    });
    if (operation.type === "replace") {
      const content = verifiedNewContent(operation);
      rejectSecrets(path, operation.mediaType, content);
    }
  }
  return { journal };
}

async function applyOperations(
  root: string,
  operations: ProposalOperation[],
): Promise<void> {
  for (const operation of operations) {
    const target = resolve(root, ...operation.path.split("/"));
    if (operation.type === "delete") {
      await rm(target);
      continue;
    }
    const content = verifiedNewContent(operation);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.agentshare-${randomUUID()}.tmp`;
    const mode =
      operation.type === "replace" ? (await lstat(target)).mode & 0o777 : 0o644;
    await writeFile(temporary, content, { mode });
    await chmod(temporary, mode).catch(() => undefined);
    await rename(temporary, target);
  }
}

async function rollbackJournal(
  owned: OwnedEnvironment,
  proposal: AgentShareProposal,
  path: string,
): Promise<void> {
  const journal = await readJournal(owned, proposal, path);
  for (const entry of [...journal.entries].reverse()) {
    const target = resolve(owned.workspaceRoot, ...entry.path.split("/"));
    if (entry.type === "create") {
      await rm(target, { force: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.agentshare-rollback-${randomUUID()}.tmp`;
    await writeFile(temporary, Buffer.from(entry.contentBase64, "base64"), {
      mode: entry.mode,
    });
    await chmod(temporary, entry.mode).catch(() => undefined);
    await rename(temporary, target);
  }
}

async function writeJournal(
  owned: OwnedEnvironment,
  proposal: AgentShareProposal,
  journal: ApplyJournal,
  path: string,
): Promise<void> {
  const encrypted = encryptEnvironmentObject(
    Buffer.from(JSON.stringify(journal), "utf8"),
    keyFromFragment(owned.environmentMasterKey),
    {
      environmentId: owned.environmentId,
      revisionId: proposal.baseRevisionId,
      kind: "index",
      objectId: `transaction_${proposal.proposalId}`,
    },
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, Buffer.from(encrypted.envelope), { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function readJournal(
  owned: OwnedEnvironment,
  proposal: AgentShareProposal,
  path: string,
): Promise<ApplyJournal> {
  const encrypted = await readFile(path);
  const parsed = JSON.parse(
    Buffer.from(
      decryptEnvironmentObject(
        encrypted,
        keyFromFragment(owned.environmentMasterKey),
        {
          environmentId: owned.environmentId,
          revisionId: proposal.baseRevisionId,
          kind: "index",
          objectId: `transaction_${proposal.proposalId}`,
        },
      ),
    ).toString("utf8"),
  ) as ApplyJournal;
  if (
    parsed.version !== 1 ||
    parsed.proposalId !== proposal.proposalId ||
    parsed.environmentId !== proposal.environmentId ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("Invalid AgentShare rollback journal");
  }
  return parsed;
}

function verifiedNewContent(
  operation: Extract<ProposalOperation, { type: "create" | "replace" }>,
): Buffer {
  const content = Buffer.from(operation.contentBase64, "base64");
  if (sha256(content) !== operation.newSha256) {
    throw new Error(`Proposal new-content hash mismatch for ${operation.path}`);
  }
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
        byteLength: content.byteLength,
        sha256: sha256(content),
        contentBase64: content.toString("base64"),
        sourcePath: path,
      },
    ],
  });
  if (scan.findings.length > 0) {
    throw new Error(`Proposal contains a suspected secret in ${path}`);
  }
}

async function assertParentsSafe(root: string, path: string): Promise<void> {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = resolve(root, ...parts.slice(0, index));
    try {
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Proposal path traverses a symlink: ${path}`);
      }
      if (!metadata.isDirectory()) {
        throw new Error(`Proposal path parent is not a directory: ${path}`);
      }
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
  }
}

function assertInside(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Proposal path escapes workspace root");
  }
}

function transactionJournalPath(
  proposalId: string,
  statePath = defaultEnvironmentStatePath(),
): string {
  return join(dirname(statePath), "transactions", `${proposalId}.enc`);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}