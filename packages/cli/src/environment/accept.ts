import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  decryptEnvironmentObject,
  encryptEnvironmentObject,
  parseEnvironmentUrl,
  sha256Hex,
} from "@agentshare/acb";
import {
  environmentManifestSchema,
  type EnvironmentManifest,
  type SharedFile,
} from "@agentshare/contracts";
import {
  buildSearchIndex,
  searchIndex,
  type EnvironmentSearchHit,
  type SearchIndex,
} from "./index.js";
import { EnvironmentRelayClient } from "./relay-client.js";
import {
  findAttachedEnvironment,
  saveAttachedEnvironment,
  type AttachedEnvironment,
} from "./state.js";

export type AcceptEnvironmentResult = {
  environmentId: string;
  revisionId: string;
  title: string;
  files: number;
  conversationEvents: number;
  canPropose: boolean;
  expiresAt: string;
};

export type EnvironmentReadOptions = {
  statePath?: string;
  cacheRoot?: string;
};

export async function acceptEnvironmentLink(
  link: string,
  options: {
    client?: EnvironmentRelayClient;
    statePath?: string;
    cacheRoot?: string;
    now?: () => Date;
  } = {},
): Promise<AcceptEnvironmentResult> {
  const parsed = parseEnvironmentUrl(link);
  const client =
    options.client ??
    new EnvironmentRelayClient(new URL(parsed.safeUrl).origin);
  if (client.origin !== new URL(parsed.safeUrl).origin) {
    throw new Error("AgentShare environment link relay does not match client");
  }
  const metadata = await client.metadata(
    parsed.environmentId,
    parsed.readCapability,
  );
  if (metadata.status !== "active" || metadata.currentRevision === null) {
    throw new Error("AgentShare environment has no committed revision");
  }
  const revision = metadata.currentRevision;
  const manifestCiphertext = await client.downloadManifest(
    parsed.environmentId,
    revision.revisionId,
    parsed.readCapability,
  );
  assertDescriptor(
    revision.manifest,
    manifestCiphertext,
    "environment manifest",
  );
  const manifest = environmentManifestSchema.parse(
    JSON.parse(
      Buffer.from(
        decryptEnvironmentObject(
          manifestCiphertext,
          parsed.environmentMasterKey,
          {
            environmentId: parsed.environmentId,
            revisionId: revision.revisionId,
            kind: "manifest",
            objectId: `manifest_${revision.revisionId}`,
          },
        ),
      ).toString("utf8"),
    ) as unknown,
  );
  if (
    manifest.environmentId !== parsed.environmentId ||
    manifest.revisionId !== revision.revisionId
  ) {
    throw new Error("AgentShare environment manifest identity mismatch");
  }

  const root = environmentCacheDirectory(
    parsed.environmentId,
    options.cacheRoot,
  );
  await mkdir(join(root, "blobs"), { recursive: true, mode: 0o700 });
  await writeSecure(join(root, "manifest.enc"), manifestCiphertext);
  const declared = new Map(revision.blobs.map((blob) => [blob.blobId, blob]));
  for (const file of manifest.workspace.files) {
    for (const reference of file.blobs) {
      const descriptor = declared.get(reference.blobId);
      if (descriptor === undefined) {
        throw new Error(
          `Manifest references undeclared blob ${reference.blobId}`,
        );
      }
      const path = join(root, "blobs", `${reference.blobId}.enc`);
      const existing = await readValidCiphertext(path, descriptor);
      if (existing !== undefined) continue;
      const bytes = await client.downloadBlob(
        parsed.environmentId,
        reference.blobId,
        parsed.readCapability,
      );
      assertDescriptor(
        descriptor,
        bytes,
        `environment blob ${reference.blobId}`,
      );
      await writeSecure(path, bytes);
    }
  }

  const index = await buildIndexFromManifest(
    manifest,
    parsed.environmentMasterKey,
    root,
  );
  const encryptedIndex = encryptEnvironmentObject(
    Buffer.from(JSON.stringify(index), "utf8"),
    parsed.environmentMasterKey,
    {
      environmentId: parsed.environmentId,
      revisionId: revision.revisionId,
      kind: "index",
      objectId: "index_v1",
    },
  );
  await writeSecure(join(root, "index.enc"), encryptedIndex.envelope);

  const attached: AttachedEnvironment = {
    environmentId: parsed.environmentId,
    relayOrigin: client.origin,
    environmentMasterKey: Buffer.from(parsed.environmentMasterKey).toString(
      "base64url",
    ),
    readCapability: parsed.readCapability,
    ...(parsed.proposalCapability === undefined
      ? {}
      : { proposalCapability: parsed.proposalCapability }),
    currentRevisionId: revision.revisionId,
    expiresAt: metadata.expiresAt,
    attachedAt: (options.now ?? (() => new Date()))().toISOString(),
    title: manifest.title,
  };
  await saveAttachedEnvironment(attached, options.statePath);

  return {
    environmentId: attached.environmentId,
    revisionId: revision.revisionId,
    title: manifest.title,
    files: manifest.workspace.files.length,
    conversationEvents: manifest.conversation.events.length,
    canPropose:
      manifest.proposalPolicy.enabled &&
      attached.proposalCapability !== undefined,
    expiresAt: metadata.expiresAt,
  };
}

export async function searchAttachedEnvironment(
  environmentId: string,
  query: string,
  options: EnvironmentReadOptions = {},
): Promise<EnvironmentSearchHit[]> {
  const attached = await requiredAttached(environmentId, options.statePath);
  const revisionId = requiredRevision(attached);
  const root = environmentCacheDirectory(environmentId, options.cacheRoot);
  const encrypted = await readFile(join(root, "index.enc"));
  const index = JSON.parse(
    Buffer.from(
      decryptEnvironmentObject(
        encrypted,
        Buffer.from(attached.environmentMasterKey, "base64url"),
        {
          environmentId,
          revisionId,
          kind: "index",
          objectId: "index_v1",
        },
      ),
    ).toString("utf8"),
  ) as SearchIndex;
  if (index.version !== 1 || !Array.isArray(index.entries)) {
    throw new Error("Invalid AgentShare environment search index");
  }
  return searchIndex(index, query);
}

export async function readAttachedFile(
  environmentId: string,
  path: string,
  options: EnvironmentReadOptions = {},
): Promise<string> {
  const attached = await requiredAttached(environmentId, options.statePath);
  const root = environmentCacheDirectory(environmentId, options.cacheRoot);
  const manifest = await loadCachedManifest(attached, root);
  const file = manifest.workspace.files.find(
    (candidate) => candidate.path === path,
  );
  if (file === undefined) throw new Error(`Shared file not found: ${path}`);
  const bytes = await readSharedFileBytes(attached, root, file);
  if (
    !file.mediaType.startsWith("text/") &&
    file.mediaType !== "application/json"
  ) {
    throw new Error(`Shared file is not text-readable: ${path}`);
  }
  return Buffer.from(bytes).toString("utf8");
}

export async function readAttachedManifest(
  environmentId: string,
  options: EnvironmentReadOptions = {},
): Promise<EnvironmentManifest> {
  const attached = await requiredAttached(environmentId, options.statePath);
  return loadCachedManifest(
    attached,
    environmentCacheDirectory(environmentId, options.cacheRoot),
  );
}

async function buildIndexFromManifest(
  manifest: EnvironmentManifest,
  masterKey: Uint8Array,
  root: string,
): Promise<SearchIndex> {
  const inputs: Parameters<typeof buildSearchIndex>[0] = [];
  for (const event of manifest.conversation.events) {
    inputs.push({
      kind: "conversation",
      source: `${event.sourceId}#event-${event.sequence}`,
      text: event.text,
      sequence: event.sequence,
    });
  }
  const attached: AttachedEnvironment = {
    environmentId: manifest.environmentId,
    relayOrigin: "cache-only",
    environmentMasterKey: Buffer.from(masterKey).toString("base64url"),
    readCapability: "cache-only",
    currentRevisionId: manifest.revisionId,
    expiresAt: manifest.createdAt,
    attachedAt: manifest.createdAt,
    title: manifest.title,
  };
  for (const file of manifest.workspace.files) {
    if (
      !file.mediaType.startsWith("text/") &&
      file.mediaType !== "application/json"
    ) {
      continue;
    }
    const bytes = await readSharedFileBytes(attached, root, file);
    inputs.push({
      kind: "file",
      source: file.path,
      text: Buffer.from(bytes).toString("utf8"),
    });
  }
  return buildSearchIndex(inputs);
}

async function loadCachedManifest(
  attached: AttachedEnvironment,
  root: string,
): Promise<EnvironmentManifest> {
  const revisionId = requiredRevision(attached);
  const encrypted = await readFile(join(root, "manifest.enc"));
  return environmentManifestSchema.parse(
    JSON.parse(
      Buffer.from(
        decryptEnvironmentObject(
          encrypted,
          Buffer.from(attached.environmentMasterKey, "base64url"),
          {
            environmentId: attached.environmentId,
            revisionId,
            kind: "manifest",
            objectId: `manifest_${revisionId}`,
          },
        ),
      ).toString("utf8"),
    ) as unknown,
  );
}

async function readSharedFileBytes(
  attached: AttachedEnvironment,
  root: string,
  file: SharedFile,
): Promise<Uint8Array> {
  const masterKey = Buffer.from(attached.environmentMasterKey, "base64url");
  const parts: Buffer[] = [];
  for (const reference of [...file.blobs].sort(
    (left, right) => left.byteOffset - right.byteOffset,
  )) {
    const encrypted = await readFile(
      join(root, "blobs", `${reference.blobId}.enc`),
    );
    const plaintext = decryptEnvironmentObject(encrypted, masterKey, {
      environmentId: attached.environmentId,
      revisionId: "shared-blobs",
      kind: "blob",
      objectId: reference.blobId,
    });
    parts.push(Buffer.from(plaintext));
  }
  const combined = Buffer.concat(parts);
  if (
    combined.byteLength !== file.byteLength ||
    sha256Hex(combined) !== file.sha256
  ) {
    throw new Error(`Shared file integrity mismatch: ${file.path}`);
  }
  return combined;
}

async function requiredAttached(
  environmentId: string,
  statePath?: string,
): Promise<AttachedEnvironment> {
  const attached = await findAttachedEnvironment(environmentId, statePath);
  if (attached === undefined) {
    throw new Error(`AgentShare environment is not attached: ${environmentId}`);
  }
  if (Date.parse(attached.expiresAt) <= Date.now()) {
    throw new Error("AgentShare environment has expired");
  }
  return attached;
}

function requiredRevision(attached: AttachedEnvironment): string {
  if (attached.currentRevisionId === null) {
    throw new Error("AgentShare environment has no cached revision");
  }
  return attached.currentRevisionId;
}

function environmentCacheDirectory(
  environmentId: string,
  cacheRoot = join(homedir(), ".agentshare", "cache"),
): string {
  return join(cacheRoot, environmentId);
}

async function writeSecure(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, Buffer.from(bytes), { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function readValidCiphertext(
  path: string,
  descriptor: { ciphertextSha256: string; ciphertextBytes: number },
): Promise<Uint8Array | undefined> {
  try {
    const metadata = await stat(path);
    if (metadata.size !== descriptor.ciphertextBytes) return undefined;
    const bytes = await readFile(path);
    return sha256Hex(bytes) === descriptor.ciphertextSha256 ? bytes : undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function assertDescriptor(
  descriptor: { ciphertextSha256: string; ciphertextBytes: number },
  bytes: Uint8Array,
  label: string,
): void {
  if (
    bytes.byteLength !== descriptor.ciphertextBytes ||
    sha256Hex(bytes) !== descriptor.ciphertextSha256
  ) {
    throw new Error(`${label} descriptor mismatch`);
  }
}
