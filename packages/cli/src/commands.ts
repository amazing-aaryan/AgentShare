import { createInterface } from "node:readline/promises";
import {
  buildShareUrl,
  capabilityDigest,
  encodeAcb,
  encryptBundle,
  keyToFragment,
  logicalFingerprint,
  parseShareUrl,
  randomCapability,
} from "@agentshare/acb";
import { exportCurrentClaudeSession } from "@agentshare/adapter-claude";
import { exportCurrentCodexSession } from "@agentshare/adapter-codex";
import type { AcbManifest } from "@agentshare/contracts";
import {
  reviewInventory,
  reviewPayload,
  scanAndRedact,
} from "@agentshare/scanner";
import { manifestFromTextFile } from "./manifest.js";
import { evidencePrompt, retrieveEvidence } from "./retrieval.js";
import { openShare } from "./handoff.js";
import { runTarget, type TargetAgent } from "./launchers.js";
import { RelayClient, RelayClientError } from "./relay-client.js";
import {
  findReusableShare,
  findShareByUrl,
  removeShareByUrl,
  saveShare,
  type LocalShare,
} from "./state.js";
import { confirm, readHiddenLine } from "./terminal.js";

export type ShareOptions = {
  inputPath?: string;
  current?: boolean;
  relayOrigin: string;
  ttlSeconds: number;
  sourceAgent?: "codex" | "claude" | "generic";
  yes?: boolean;
  forceNew?: boolean;
  statePath?: string;
};

export { openShare } from "./handoff.js";

export async function shareCommand(options: ShareOptions): Promise<string> {
  const selected = await selectManifest(await loadManifest(options), options);
  const scanned = scanAndRedact(selected);
  const fingerprint = logicalFingerprint(scanned.manifest);
  const client = new RelayClient(options.relayOrigin);
  if (!options.forceNew) {
    const reusable = await findReusableShare(
      fingerprint,
      client.origin,
      options.statePath,
    );
    if (reusable !== undefined) {
      const resumed = await resumeReusableShare(
        reusable,
        client,
        options.statePath,
      );
      if (resumed !== undefined) return resumed;
    }
  }

  process.stdout.write(`${reviewInventory(scanned.manifest).join("\n")}\n`);
  process.stdout.write(`redactions: ${scanned.findings.length}\n`);
  process.stdout.write(
    `\nFinal normalized plaintext:\n${reviewPayload(scanned.manifest)}\n`,
  );
  process.stdout.write(`fingerprint: ${fingerprint}\n`);
  if (
    !options.yes &&
    !(await confirm("Share this exact normalized payload?"))
  ) {
    throw new Error("Share cancelled before upload");
  }

  const shareId = randomCapability(18);
  const uploadCapability = randomCapability();
  const readCapability = randomCapability();
  const revokeCapability = randomCapability();
  const created = await client.create({
    shareId,
    requestedTtlSeconds: options.ttlSeconds,
    uploadTokenDigest: capabilityDigest(uploadCapability),
    readTokenDigest: capabilityDigest(readCapability),
    revokeTokenDigest: capabilityDigest(revokeCapability),
  });
  process.stdout.write(
    `authoritative expiry: ${created.metadata.expiresAt}\nmax bytes: ${created.metadata.limits.maxCiphertextBytes}\n`,
  );
  if (!options.yes && !(await confirm("Accept relay expiry and limits?"))) {
    throw new Error("Share cancelled before encryption");
  }

  const encrypted = encryptBundle(
    encodeAcb(scanned.manifest),
    created.metadata,
  );
  const url = buildShareUrl({
    origin: client.origin,
    shareId,
    readCapability,
    fragmentKey: keyToFragment(encrypted.key),
  });
  const pending: LocalShare = {
    fingerprint,
    relayOrigin: client.origin,
    shareId,
    url,
    revokeCapability,
    expiresAt: created.metadata.expiresAt,
    pendingUpload: {
      uploadCapability,
      ciphertextSha256: encrypted.ciphertextSha256,
      envelopeBase64: Buffer.from(encrypted.envelope).toString("base64"),
    },
  };
  await saveShare(pending, options.statePath);
  await uploadPending(client, pending);
  await bestEffortFinalize(pending, options.statePath);
  return url;
}

async function resumeReusableShare(
  share: LocalShare,
  client: RelayClient,
  statePath?: string,
): Promise<string | undefined> {
  try {
    const response = await client.metadata(
      share.shareId,
      parseShareUrl(share.url).readCapability,
    );
    if (response.status === "available") {
      if (share.pendingUpload !== undefined)
        await bestEffortFinalize(share, statePath);
      return share.url;
    }
    if (
      response.status === "awaiting-upload" &&
      share.pendingUpload !== undefined
    ) {
      await uploadPending(client, share);
      await bestEffortFinalize(share, statePath);
      return share.url;
    }
  } catch (error) {
    if (
      !(error instanceof RelayClientError) ||
      ![404, 410].includes(error.status)
    ) {
      throw error;
    }
  }
  await removeShareByUrl(share.url, statePath);
  return undefined;
}

async function uploadPending(
  client: RelayClient,
  share: LocalShare,
): Promise<void> {
  const pending = share.pendingUpload;
  if (pending === undefined) throw new Error("Missing pending upload state");
  await client.upload({
    shareId: share.shareId,
    uploadCapability: pending.uploadCapability,
    ciphertextSha256: pending.ciphertextSha256,
    envelope: Buffer.from(pending.envelopeBase64, "base64"),
  });
}

async function finalizeShare(
  share: LocalShare,
  statePath?: string,
): Promise<void> {
  const available: LocalShare = {
    fingerprint: share.fingerprint,
    relayOrigin: share.relayOrigin,
    shareId: share.shareId,
    url: share.url,
    revokeCapability: share.revokeCapability,
    expiresAt: share.expiresAt,
  };
  await saveShare(available, statePath);
}

async function bestEffortFinalize(
  share: LocalShare,
  statePath?: string,
): Promise<void> {
  try {
    await finalizeShare(share, statePath);
  } catch (error) {
    process.stderr.write(
      `Warning: upload succeeded but local state cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

async function selectManifest(
  manifest: AcbManifest,
  options: ShareOptions,
): Promise<AcbManifest> {
  if (
    options.current !== true ||
    options.yes === true ||
    manifest.events.length <= 1
  ) {
    return manifest;
  }
  process.stdout.write("Available events:\n");
  for (const event of manifest.events) {
    const preview = event.text.replace(/\s+/gu, " ").trim().slice(0, 120);
    process.stdout.write(`${event.sequence}: ${event.role} ${preview}\n`);
  }
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (
      await input.question(
        `Select inclusive event range [0-${manifest.events.length - 1}]: `,
      )
    ).trim();
    const match = /^(\d+)-(\d+)$/u.exec(answer);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error("Selection must use start-end, for example 2-14");
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start < 0 || end < start || end >= manifest.events.length) {
      throw new Error("Selected event range is outside this session");
    }
    return {
      ...manifest,
      events: manifest.events.slice(start, end + 1).map((event, sequence) => ({
        ...event,
        sequence,
      })),
    };
  } finally {
    input.close();
  }
}

async function loadManifest(options: ShareOptions): Promise<AcbManifest> {
  if (options.current === true) {
    if (options.sourceAgent === "codex") return exportCurrentCodexSession();
    if (options.sourceAgent === "claude") return exportCurrentClaudeSession();
    throw new Error("--current requires --source codex or claude");
  }
  if (options.inputPath === undefined)
    throw new Error("Missing input file or --current");
  return manifestFromTextFile(options.inputPath, options.sourceAgent);
}

export async function openCommand(target: TargetAgent): Promise<void> {
  const link = await readHiddenLine("AgentShare link: ");
  const { manifest, metadata } = await openShare(link);
  process.stdout.write(
    `Opened ${manifest.title} from ${manifest.sourceAgent}; expires ${metadata.expiresAt}\n`,
  );

  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    while (true) {
      const query = (await input.question("agentshare> ")).trim();
      if (query === "/exit" || query === "/quit") break;
      if (query.length === 0) continue;
      const evidence = retrieveEvidence(manifest, query);
      const exitCode = await runTarget(target, evidencePrompt(query, evidence));
      if (exitCode !== 0)
        process.stderr.write(`${target} exited with code ${exitCode}\n`);
    }
  } finally {
    input.close();
  }
}

export async function revokeCommand(statePath?: string): Promise<void> {
  const link = await readHiddenLine("AgentShare link to revoke: ");
  const share = await findShareByUrl(link, statePath);
  if (share === undefined)
    throw new Error("No local revocation credential for this link");
  const client = new RelayClient(share.relayOrigin);
  await client.revoke(share.shareId, share.revokeCapability);
  await removeShareByUrl(share.url, statePath);
}
