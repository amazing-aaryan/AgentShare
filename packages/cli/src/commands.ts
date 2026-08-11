import { createInterface } from "node:readline/promises";
import {
  buildShareUrl,
  capabilityDigest,
  decodeAcb,
  decryptBundle,
  encodeAcb,
  encryptBundle,
  keyFromFragment,
  keyToFragment,
  logicalFingerprint,
  parseShareUrl,
  randomCapability,
} from "@agentshare/acb";
import { exportCurrentClaudeSession } from "@agentshare/adapter-claude";
import { exportCurrentCodexSession } from "@agentshare/adapter-codex";
import type {
  AcbManifest,
  AuthoritativeMetadata,
} from "@agentshare/contracts";
import {
  reviewInventory,
  reviewPayload,
  scanAndRedact,
} from "@agentshare/scanner";
import { manifestFromTextFile } from "./manifest.js";
import { evidencePrompt, retrieveEvidence } from "./retrieval.js";
import { runTarget, type TargetAgent } from "./launchers.js";
import { RelayClient } from "./relay-client.js";
import { findReusableShare, findShareByUrl, saveShare } from "./state.js";
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
    if (reusable !== undefined) return reusable.url;
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
  await client.upload({
    shareId,
    uploadCapability,
    ciphertextSha256: encrypted.ciphertextSha256,
    envelope: encrypted.envelope,
  });
  const url = buildShareUrl({
    origin: client.origin,
    shareId,
    readCapability,
    fragmentKey: keyToFragment(encrypted.key),
  });
  await saveShare(
    {
      fingerprint,
      relayOrigin: client.origin,
      shareId,
      url,
      revokeCapability,
      expiresAt: created.metadata.expiresAt,
    },
    options.statePath,
  );
  return url;
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

export async function openShare(link: string): Promise<{
  manifest: AcbManifest;
  metadata: AuthoritativeMetadata;
}> {
  const parsed = parseShareUrl(link);
  const client = new RelayClient(new URL(parsed.safeUrl).origin);
  const response = await client.metadata(
    parsed.shareId,
    parsed.readCapability,
  );
  const envelope = await client.download(parsed.shareId, parsed.readCapability);
  const manifest = decodeAcb(
    decryptBundle(
      envelope,
      response.metadata,
      keyFromFragment(parsed.fragmentKey),
    ),
  );
  return { manifest, metadata: response.metadata };
}

export async function revokeCommand(statePath?: string): Promise<void> {
  const link = await readHiddenLine("AgentShare link to revoke: ");
  const share = await findShareByUrl(link, statePath);
  if (share === undefined)
    throw new Error("No local revocation credential for this link");
  const client = new RelayClient(share.relayOrigin);
  await client.revoke(share.shareId, share.revokeCapability);
}
