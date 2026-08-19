import { createHmac } from "node:crypto";
import {
  buildEnvironmentUrl,
  capabilityDigest,
  encryptEnvironmentObject,
  generateProposalKeyPair,
  keyFromFragment,
  keyToFragment,
  randomCapability,
  randomEnvironmentMasterKey,
} from "@agentshare/acb";
import {
  environmentManifestSchema,
  type AcbManifest,
  type CiphertextDescriptor,
  type EnvironmentManifest,
  type ReserveRevisionRequest,
  type SessionEvent,
} from "@agentshare/contracts";
import { scanAndRedact } from "@agentshare/scanner";
import {
  buildWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "../workspace/index.js";
import { EnvironmentRelayClient } from "./relay-client.js";
import { saveOwnedEnvironment, type OwnedEnvironment } from "./state.js";

export type HostCapture = {
  sourceAgent: "codex" | "claude";
  title: string;
  workspaceRoot: string;
  conversation: SessionEvent[];
};

export type CreateEnvironmentOptions = {
  client: EnvironmentRelayClient;
  statePath?: string;
  ttlSeconds: number;
  proposalsEnabled: boolean;
  includeConversation: boolean;
  includeWorkspace: boolean;
  now?: () => Date;
  workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
};

export type PublicationSummary = {
  files: number;
  conversationEvents: number;
  totalWorkspaceBytes: number;
  excludedFiles: number;
  redactions: number;
  proposalsEnabled: boolean;
};

export type CreateEnvironmentResult = {
  environment: OwnedEnvironment;
  url: string;
  summary: PublicationSummary;
};

type PreparedRevision = {
  reservation: ReserveRevisionRequest;
  manifestBytes: Uint8Array;
  newBlobs: Array<{ blobId: string; bytes: Uint8Array }>;
  summary: PublicationSummary;
};

export async function createEnvironmentFromCapture(
  capture: HostCapture,
  options: CreateEnvironmentOptions,
): Promise<CreateEnvironmentResult> {
  if (!options.includeConversation && !options.includeWorkspace) {
    throw new Error(
      "AgentShare environment must include conversation, workspace, or both",
    );
  }
  const now = options.now ?? (() => new Date());
  const environmentId = `env_${randomCapability(18)}`;
  const masterKey = randomEnvironmentMasterKey();
  const readCapability = randomCapability();
  const updateCapability = randomCapability();
  const inboxCapability = randomCapability();
  const revokeCapability = randomCapability();
  const proposalCapability = options.proposalsEnabled
    ? randomCapability()
    : undefined;
  const proposalKeys = generateProposalKeyPair();

  const created = await options.client.create({
    environmentId,
    requestedTtlSeconds: options.ttlSeconds,
    readTokenDigest: capabilityDigest(readCapability),
    updateTokenDigest: capabilityDigest(updateCapability),
    ...(proposalCapability === undefined
      ? {}
      : { proposalTokenDigest: capabilityDigest(proposalCapability) }),
    inboxTokenDigest: capabilityDigest(inboxCapability),
    revokeTokenDigest: capabilityDigest(revokeCapability),
  });

  let environment: OwnedEnvironment = {
    environmentId,
    relayOrigin: options.client.origin,
    workspaceRoot: capture.workspaceRoot,
    environmentMasterKey: keyToFragment(masterKey),
    readCapability,
    updateCapability,
    ...(proposalCapability === undefined ? {} : { proposalCapability }),
    inboxCapability,
    revokeCapability,
    proposalPublicKey: proposalKeys.publicKey,
    proposalPrivateKey: proposalKeys.privateKey,
    currentRevisionId: null,
    expiresAt: created.expiresAt,
    sharePolicy: {
      includeConversation: options.includeConversation,
      includeWorkspace: options.includeWorkspace,
      proposalsEnabled: options.proposalsEnabled,
    },
    knownBlobs: {},
  };
  await saveOwnedEnvironment(environment, options.statePath);

  const prepared = await prepareRevision(capture, environment, {
    includeConversation: options.includeConversation,
    includeWorkspace: options.includeWorkspace,
    proposalsEnabled: options.proposalsEnabled,
    now: now(),
    workspaceOptions: options.workspaceOptions,
  });
  environment = await publishPreparedRevision(
    environment,
    prepared,
    options.client,
    options.statePath,
  );

  return {
    environment,
    url: buildEnvironmentUrl({
      origin: environment.relayOrigin,
      environmentId: environment.environmentId,
      readCapability: environment.readCapability,
      environmentMasterKey: keyFromFragment(environment.environmentMasterKey),
      ...(environment.proposalCapability === undefined
        ? {}
        : { proposalCapability: environment.proposalCapability }),
    }),
    summary: prepared.summary,
  };
}

export async function publishEnvironmentRevision(
  capture: HostCapture,
  environment: OwnedEnvironment,
  client: EnvironmentRelayClient,
  options: {
    statePath?: string;
    now?: Date;
    workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  } = {},
): Promise<{ environment: OwnedEnvironment; summary: PublicationSummary }> {
  const prepared = await prepareRevision(capture, environment, {
    includeConversation: environment.sharePolicy.includeConversation,
    includeWorkspace: environment.sharePolicy.includeWorkspace,
    proposalsEnabled: environment.sharePolicy.proposalsEnabled,
    now: options.now ?? new Date(),
    workspaceOptions: options.workspaceOptions,
  });
  const published = await publishPreparedRevision(
    environment,
    prepared,
    client,
    options.statePath,
  );
  return { environment: published, summary: prepared.summary };
}

export async function resumePendingRevision(
  environment: OwnedEnvironment,
  client: EnvironmentRelayClient,
  statePath?: string,
): Promise<OwnedEnvironment> {
  const pending = environment.pendingRevision;
  if (pending === undefined) return environment;
  await client.reserveRevision(
    environment.environmentId,
    environment.updateCapability,
    pending.reservation,
  );
  await client.uploadManifest(
    environment.environmentId,
    pending.reservation.revisionId,
    environment.updateCapability,
    Buffer.from(pending.manifestBase64, "base64"),
  );
  for (const blob of pending.blobs) {
    await client.uploadBlob(
      environment.environmentId,
      blob.blobId,
      environment.updateCapability,
      Buffer.from(blob.ciphertextBase64, "base64"),
    );
  }
  const committed = await client.commitRevision(
    environment.environmentId,
    pending.reservation.revisionId,
    environment.updateCapability,
  );
  const next: OwnedEnvironment = {
    ...environment,
    currentRevisionId: committed.currentRevisionId,
    knownBlobs: {
      ...(environment.knownBlobs ?? {}),
      ...Object.fromEntries(
        pending.reservation.blobs.map((blob) => [
          blob.blobId,
          descriptorOnly(blob),
        ]),
      ),
    },
  };
  delete next.pendingRevision;
  await saveOwnedEnvironment(next, statePath);
  return next;
}

async function prepareRevision(
  capture: HostCapture,
  environment: OwnedEnvironment,
  options: {
    includeConversation: boolean;
    includeWorkspace: boolean;
    proposalsEnabled: boolean;
    now: Date;
    workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  },
): Promise<PreparedRevision> {
  const masterKey = keyFromFragment(environment.environmentMasterKey);
  const revisionId = `rev_${randomCapability(18)}`;
  const snapshot = options.includeWorkspace
    ? await buildWorkspaceSnapshot(
        capture.workspaceRoot,
        options.workspaceOptions,
      )
    : emptySnapshot(capture.workspaceRoot);
  const redacted = scanAndRedact(
    workspaceToAcb(capture, snapshot, options.includeConversation),
  );

  const newBlobs = new Map<string, Uint8Array>();
  const declaredBlobs = new Map<string, CiphertextDescriptor>();
  const files = snapshot.files.map((file, index) => {
    const resource = redacted.manifest.resources[index];
    if (resource === undefined) {
      throw new Error(`Missing scanned workspace resource for ${file.path}`);
    }
    const plaintext = Buffer.from(resource.contentBase64, "base64");
    const resourceId = stableOpaqueId(
      "res",
      masterKey,
      `${file.path}\0${resource.sha256}`,
    );
    const blobId = stableOpaqueId("blob", masterKey, resource.sha256);
    const known = environment.knownBlobs?.[blobId];
    let descriptor: CiphertextDescriptor;
    if (known !== undefined) {
      descriptor = known;
    } else {
      const encrypted = encryptEnvironmentObject(plaintext, masterKey, {
        environmentId: environment.environmentId,
        revisionId: "shared-blobs",
        kind: "blob",
        objectId: blobId,
      });
      descriptor = {
        ciphertextSha256: encrypted.ciphertextSha256,
        ciphertextBytes: encrypted.envelope.byteLength,
      };
      newBlobs.set(blobId, encrypted.envelope);
    }
    declaredBlobs.set(blobId, descriptor);
    return {
      resourceId,
      path: file.path,
      mediaType: resource.mediaType,
      byteLength: plaintext.byteLength,
      sha256: resource.sha256,
      executable: file.executable,
      blobs: [
        {
          blobId,
          byteOffset: 0,
          byteLength: plaintext.byteLength,
        },
      ],
    };
  });

  const manifest: EnvironmentManifest = environmentManifestSchema.parse({
    version: "agentshare-environment-v2",
    environmentId: environment.environmentId,
    revisionId,
    ...(environment.currentRevisionId === null
      ? {}
      : { parentRevisionId: environment.currentRevisionId }),
    createdAt: options.now.toISOString(),
    title: capture.title,
    sourceAgent: capture.sourceAgent,
    conversation: {
      events: options.includeConversation ? redacted.manifest.events : [],
    },
    workspace: {
      rootName: snapshot.rootName,
      files,
    },
    proposalPolicy: options.proposalsEnabled
      ? {
          enabled: true,
          encryptionPublicKey: requiredProposalPublicKey(environment),
        }
      : { enabled: false },
  });
  const manifestPlaintext = Buffer.from(JSON.stringify(manifest), "utf8");
  const encryptedManifest = encryptEnvironmentObject(
    manifestPlaintext,
    masterKey,
    {
      environmentId: environment.environmentId,
      revisionId,
      kind: "manifest",
      objectId: `manifest_${revisionId}`,
    },
  );
  const reservation: ReserveRevisionRequest = {
    revisionId,
    ...(environment.currentRevisionId === null
      ? {}
      : { parentRevisionId: environment.currentRevisionId }),
    manifest: {
      ciphertextSha256: encryptedManifest.ciphertextSha256,
      ciphertextBytes: encryptedManifest.envelope.byteLength,
    },
    blobs: [...declaredBlobs.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([blobId, descriptor]) => ({ blobId, ...descriptor })),
  };

  return {
    reservation,
    manifestBytes: encryptedManifest.envelope,
    newBlobs: [...newBlobs.entries()].map(([blobId, bytes]) => ({
      blobId,
      bytes,
    })),
    summary: {
      files: files.length,
      conversationEvents: manifest.conversation.events.length,
      totalWorkspaceBytes: snapshot.totalBytes,
      excludedFiles: snapshot.excluded.length,
      redactions: redacted.findings.length,
      proposalsEnabled: options.proposalsEnabled,
    },
  };
}

async function publishPreparedRevision(
  environment: OwnedEnvironment,
  prepared: PreparedRevision,
  client: EnvironmentRelayClient,
  statePath?: string,
): Promise<OwnedEnvironment> {
  const pending: OwnedEnvironment = {
    ...environment,
    pendingRevision: {
      reservation: prepared.reservation,
      manifestBase64: Buffer.from(prepared.manifestBytes).toString("base64"),
      blobs: prepared.newBlobs.map((blob) => ({
        blobId: blob.blobId,
        ciphertextBase64: Buffer.from(blob.bytes).toString("base64"),
      })),
    },
  };
  await saveOwnedEnvironment(pending, statePath);
  return resumePendingRevision(pending, client, statePath);
}

function workspaceToAcb(
  capture: HostCapture,
  snapshot: WorkspaceSnapshot,
  includeConversation: boolean,
): AcbManifest {
  return {
    version: "acb-v1",
    title: capture.title,
    sourceAgent: capture.sourceAgent,
    exportedAt: new Date().toISOString(),
    events: includeConversation ? capture.conversation : [],
    resources: snapshot.files.map((file, index) => ({
      id: `workspace-${index}`,
      mediaType: file.mediaType,
      byteLength: file.byteLength,
      sha256: file.sha256,
      contentBase64: file.contentBase64,
      sourcePath: file.path,
    })),
  };
}

function emptySnapshot(root: string): WorkspaceSnapshot {
  const rootName = root.replace(/\\/gu, "/").split("/").filter(Boolean).at(-1);
  return {
    root,
    rootName: rootName ?? "workspace",
    files: [],
    excluded: [],
    totalBytes: 0,
  };
}

function stableOpaqueId(
  prefix: string,
  key: Uint8Array,
  value: string,
): string {
  const digest = createHmac("sha256", Buffer.from(key))
    .update(value, "utf8")
    .digest("base64url")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function descriptorOnly(value: {
  ciphertextSha256: string;
  ciphertextBytes: number;
}): CiphertextDescriptor {
  return {
    ciphertextSha256: value.ciphertextSha256,
    ciphertextBytes: value.ciphertextBytes,
  };
}

function requiredProposalPublicKey(environment: OwnedEnvironment): string {
  if (environment.proposalPublicKey === undefined) {
    throw new Error("Missing creator proposal public key");
  }
  return environment.proposalPublicKey;
}
