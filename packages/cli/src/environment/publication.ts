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
import type { WorkspaceSnapshot } from "../workspace/index.js";
import {
  previewEnvironmentCapture,
  verifyPreparedCapture,
  type PreparedCapture,
} from "./preview.js";
import { EnvironmentRelayClient } from "./relay-client.js";
import {
  findOwnedEnvironment,
  saveOwnedEnvironment,
  withEnvironmentLock,
  type OwnedEnvironment,
} from "./state.js";

export type HostCapture = {
  sourceAgent: "codex" | "claude";
  title: string;
  workspaceRoot: string;
  conversation: SessionEvent[];
};

export type CreateEnvironmentOptions = {
  onPreparedEnvironment?: (
    environmentId: string,
    revisionId: string,
  ) => Promise<void>;
  preparedCapture?: PreparedCapture;
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
  workspaceRoot: string;
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
  const retained =
    options.preparedCapture ??
    (await previewEnvironmentCapture(capture, options));
  verifyPreparedCapture(retained);
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

  const creationRequest = {
    environmentId,
    requestedTtlSeconds: options.ttlSeconds,
    readTokenDigest: capabilityDigest(readCapability),
    updateTokenDigest: capabilityDigest(updateCapability),
    ...(proposalCapability === undefined
      ? {}
      : { proposalTokenDigest: capabilityDigest(proposalCapability) }),
    inboxTokenDigest: capabilityDigest(inboxCapability),
    revokeTokenDigest: capabilityDigest(revokeCapability),
  };

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
    expiresAt: new Date(
      now().getTime() + options.ttlSeconds * 1000,
    ).toISOString(),
    creationRequest,
    sharePolicy: {
      includeConversation: options.includeConversation,
      includeWorkspace: options.includeWorkspace,
      proposalsEnabled: options.proposalsEnabled,
    },
    knownBlobs: {},
  };
  const prepared = await prepareRevision(capture, environment, {
    preparedCapture: retained,
    includeConversation: options.includeConversation,
    includeWorkspace: options.includeWorkspace,
    proposalsEnabled: options.proposalsEnabled,
    now: now(),
    ...(options.workspaceOptions === undefined
      ? {}
      : { workspaceOptions: options.workspaceOptions }),
  });
  environment = await withEnvironmentLock(
    environmentId,
    options.statePath,
    () =>
      publishPreparedRevision(
        environment,
        prepared,
        options.client,
        options.statePath,
        undefined,
        options.onPreparedEnvironment,
      ),
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
    preparedCapture?: PreparedCapture;
    onPreparedRevision?: (
      environmentId: string,
      revisionId: string,
    ) => Promise<void>;
    approvedWorkspaceRoot?: string;
    statePath?: string;
    now?: Date;
    proposalId?: string;
    workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  } = {},
): Promise<{ environment: OwnedEnvironment; summary: PublicationSummary }> {
  return withEnvironmentLock(
    environment.environmentId,
    options.statePath,
    async () => {
      const latest = await findOwnedEnvironment(
        environment.environmentId,
        options.statePath,
      );
      if (
        latest?.currentRevisionId !== environment.currentRevisionId ||
        (latest.generation ?? 0) !== (environment.generation ?? 0)
      )
        throw new Error("Environment changed; review again");
      if (latest.pendingRevision !== undefined)
        throw new Error(
          "Environment publication pending; recover before updating",
        );
      if (client.origin !== environment.relayOrigin)
        throw new Error("Update relay does not match owned environment");
      if (
        capture.workspaceRoot !== environment.workspaceRoot &&
        options.approvedWorkspaceRoot !== capture.workspaceRoot
      ) {
        throw new Error(
          "Update project differs from owned workspace; explicit relocation review required",
        );
      }
      const prepared = await prepareRevision(capture, environment, {
        ...(options.preparedCapture === undefined
          ? {}
          : { preparedCapture: options.preparedCapture }),
        includeConversation: environment.sharePolicy.includeConversation,
        includeWorkspace: environment.sharePolicy.includeWorkspace,
        proposalsEnabled: environment.sharePolicy.proposalsEnabled,
        now: options.now ?? new Date(),
        ...(options.workspaceOptions === undefined
          ? {}
          : { workspaceOptions: options.workspaceOptions }),
      });
      const published = await publishPreparedRevision(
        environment,
        prepared,
        client,
        options.statePath,
        options.proposalId,
        options.onPreparedRevision,
      );
      return { environment: published, summary: prepared.summary };
    },
  );
}

export async function resumePendingRevision(
  environment: OwnedEnvironment,
  client: EnvironmentRelayClient,
  statePath?: string,
  expectedRevisionId?: string,
): Promise<OwnedEnvironment> {
  return withEnvironmentLock(environment.environmentId, statePath, async () => {
    const latest = await findOwnedEnvironment(
      environment.environmentId,
      statePath,
    );
    if (latest === undefined)
      throw new Error("Owned environment was removed; recovery refused");
    environment = latest;
    const pending = environment.pendingRevision;
    if (
      expectedRevisionId !== undefined &&
      (pending?.reservation.revisionId ?? environment.currentRevisionId) !==
        expectedRevisionId
    ) {
      throw new Error(
        "Pending publication identity changed; refusing recovery",
      );
    }
    if (pending === undefined) return environment;
    if (client.origin !== environment.relayOrigin)
      throw new Error("Recovery relay does not match owned environment");
    if (environment.creationRequest !== undefined) {
      let metadata;
      try {
        metadata = await client.metadata(
          environment.environmentId,
          environment.readCapability,
        );
      } catch (error) {
        if (!(
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ))
          throw error;
        metadata = await client.create(environment.creationRequest);
      }
      environment.expiresAt = metadata.expiresAt;
      delete environment.creationRequest;
      await saveOwnedEnvironment(environment, statePath);
    }
    const metadata = await client.metadata(
      environment.environmentId,
      environment.readCapability,
    );
    let committed = metadata;
    if (metadata.currentRevisionId !== pending.reservation.revisionId) {
      if (
        metadata.currentRevisionId !==
        (pending.reservation.parentRevisionId ?? null)
      ) {
        throw new Error(
          "Pending revision base changed; recovery requires review",
        );
      }
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
      committed = await client.commitRevision(
        environment.environmentId,
        pending.reservation.revisionId,
        environment.updateCapability,
      );
    }
    const committedManifest = committed.currentRevision?.manifest;
    if (
      committed.environmentId !== environment.environmentId ||
      committed.currentRevisionId !== pending.reservation.revisionId ||
      committedManifest?.ciphertextSha256 !==
        pending.reservation.manifest.ciphertextSha256 ||
      committedManifest.ciphertextBytes !==
        pending.reservation.manifest.ciphertextBytes
    ) {
      throw new Error(
        "Relay commit receipt does not match pending revision; recovery required",
      );
    }
    if (pending.proposalId !== undefined) {
      await client.setProposalStatus(
        environment.environmentId,
        pending.proposalId,
        environment.inboxCapability,
        "accepted",
      );
    }
    const next: OwnedEnvironment = {
      ...environment,
      currentRevisionId: committed.currentRevisionId,
      workspaceRoot: pending.workspaceRoot ?? environment.workspaceRoot,
      committedManifestBase64: pending.manifestBase64,
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
  });
}

async function prepareRevision(
  capture: HostCapture,
  environment: OwnedEnvironment,
  options: {
    preparedCapture?: PreparedCapture;
    includeConversation: boolean;
    includeWorkspace: boolean;
    proposalsEnabled: boolean;
    now: Date;
    workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  },
): Promise<PreparedRevision> {
  const masterKey = keyFromFragment(environment.environmentMasterKey);
  const revisionId = `rev_${randomCapability(18)}`;
  const retained =
    options.preparedCapture ??
    (await previewEnvironmentCapture(capture, options));
  verifyPreparedCapture(retained);
  if (
    retained.capture.workspaceRoot !== capture.workspaceRoot ||
    retained.summary.proposalsEnabled !== options.proposalsEnabled ||
    (!options.includeWorkspace && retained.snapshot.files.length !== 0) ||
    (!options.includeConversation && retained.capture.conversation.length !== 0)
  ) {
    throw new Error("Prepared capture policy mismatch; review again");
  }
  const snapshot = retained.snapshot;
  const redacted = {
    manifest: workspaceToAcb(
      retained.capture,
      snapshot,
      options.includeConversation,
    ),
    findings: retained.findings,
  };

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
    title: retained.capture.title,
    sourceAgent: retained.capture.sourceAgent,
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
    workspaceRoot: retained.capture.workspaceRoot,
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
  proposalId?: string,
  onPreparedEnvironment?: (
    environmentId: string,
    revisionId: string,
  ) => Promise<void>,
): Promise<OwnedEnvironment> {
  const pending: OwnedEnvironment = {
    ...environment,
    pendingRevision: {
      workspaceRoot: prepared.workspaceRoot,
      reservation: prepared.reservation,
      manifestBase64: Buffer.from(prepared.manifestBytes).toString("base64"),
      ...(proposalId === undefined ? {} : { proposalId }),
      blobs: prepared.newBlobs.map((blob) => ({
        blobId: blob.blobId,
        ciphertextBase64: Buffer.from(blob.bytes).toString("base64"),
      })),
    },
  };
  await saveOwnedEnvironment(pending, statePath);
  await onPreparedEnvironment?.(
    pending.environmentId,
    prepared.reservation.revisionId,
  );
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
