import {
  MAX_CIPHERTEXT_BYTES,
  MAX_TTL_SECONDS,
  createEnvironmentRequestSchema,
  proposalDescriptorSchema,
  reserveRevisionRequestSchema,
  type CiphertextDescriptor,
  type CreateEnvironmentRequest,
  type EnvironmentStatus,
  type ProposalDescriptor,
  type ProposalStatus,
  type ReserveRevisionRequest,
  type RevisionStatus,
} from "./index.js";

export class EnvironmentStateError extends Error {
  constructor(
    readonly code:
      "NOT_FOUND" | "CONFLICT" | "EXPIRED" | "REVOKED" | "PAYLOAD_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "EnvironmentStateError";
  }
}

export type EnvironmentRevisionRecord = {
  request: ReserveRevisionRequest;
  status: RevisionStatus;
  manifestUploaded: boolean;
};

export type EnvironmentProposalRecord = {
  descriptor: ProposalDescriptor;
  status: ProposalStatus;
};

export type EnvironmentRecord = {
  protocolVersion: "agentshare-environment-relay-v2";
  environmentId: string;
  createdAt: string;
  expiresAt: string;
  status: EnvironmentStatus;
  currentRevisionId: string | null;
  limits: {
    maxCiphertextBytes: number;
    maxTtlSeconds: number;
  };
  readTokenDigest: string;
  updateTokenDigest: string;
  proposalTokenDigest?: string;
  inboxTokenDigest: string;
  revokeTokenDigest: string;
  revisions: Record<string, EnvironmentRevisionRecord>;
  blobs: Record<string, CiphertextDescriptor>;
  proposals: Record<string, EnvironmentProposalRecord>;
};

export function createEnvironmentRecord(
  input: CreateEnvironmentRequest,
  now: Date,
): EnvironmentRecord {
  const request = createEnvironmentRequestSchema.parse(input);
  const ttl = Math.min(request.requestedTtlSeconds, MAX_TTL_SECONDS);
  return {
    protocolVersion: "agentshare-environment-relay-v2",
    environmentId: request.environmentId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    status: "active",
    currentRevisionId: null,
    limits: {
      maxCiphertextBytes: MAX_CIPHERTEXT_BYTES,
      maxTtlSeconds: MAX_TTL_SECONDS,
    },
    readTokenDigest: request.readTokenDigest,
    updateTokenDigest: request.updateTokenDigest,
    ...(request.proposalTokenDigest === undefined
      ? {}
      : { proposalTokenDigest: request.proposalTokenDigest }),
    inboxTokenDigest: request.inboxTokenDigest,
    revokeTokenDigest: request.revokeTokenDigest,
    revisions: {},
    blobs: {},
    proposals: {},
  };
}

export function effectiveEnvironmentStatus(
  record: EnvironmentRecord,
  now: Date,
): EnvironmentStatus {
  if (record.status === "revoked") return "revoked";
  if (
    record.status === "expired" ||
    now.getTime() >= Date.parse(record.expiresAt)
  ) {
    return "expired";
  }
  return "active";
}

export function reserveEnvironmentRevision(
  record: EnvironmentRecord,
  input: ReserveRevisionRequest,
  now: Date,
): EnvironmentRecord {
  assertActive(record, now);
  const request = reserveRevisionRequestSchema.parse(input);
  const expectedParent = record.currentRevisionId ?? undefined;
  if (request.parentRevisionId !== expectedParent) {
    throw new EnvironmentStateError(
      "CONFLICT",
      `Revision parent ${request.parentRevisionId ?? "<none>"} does not match current ${expectedParent ?? "<none>"}`,
    );
  }
  const existing = record.revisions[request.revisionId];
  if (existing !== undefined) {
    if (JSON.stringify(existing.request) === JSON.stringify(request))
      return record;
    throw new EnvironmentStateError(
      "CONFLICT",
      "Revision id already exists with different descriptors",
    );
  }
  return {
    ...record,
    revisions: {
      ...record.revisions,
      [request.revisionId]: {
        request,
        status: "awaiting-blobs",
        manifestUploaded: false,
      },
    },
  };
}

export function recordEnvironmentManifest(
  record: EnvironmentRecord,
  revisionId: string,
  descriptor: CiphertextDescriptor,
  now: Date,
): EnvironmentRecord {
  assertActive(record, now);
  const revision = requiredRevision(record, revisionId);
  assertDescriptorMatches(
    revision.request.manifest,
    descriptor,
    "Revision manifest",
  );
  if (revision.manifestUploaded) return record;
  return {
    ...record,
    revisions: {
      ...record.revisions,
      [revisionId]: { ...revision, manifestUploaded: true },
    },
  };
}

export function recordEnvironmentBlob(
  record: EnvironmentRecord,
  blobId: string,
  descriptor: CiphertextDescriptor,
  now: Date,
): EnvironmentRecord {
  assertActive(record, now);
  const existing = record.blobs[blobId];
  if (existing !== undefined) {
    assertDescriptorMatches(existing, descriptor, "Environment blob");
    return record;
  }
  const declared = Object.values(record.revisions)
    .flatMap((revision) => revision.request.blobs)
    .find((blob) => blob.blobId === blobId);
  if (declared === undefined) {
    throw new EnvironmentStateError(
      "NOT_FOUND",
      "Blob is not declared by an environment revision",
    );
  }
  assertDescriptorMatches(declared, descriptor, "Environment blob");
  return {
    ...record,
    blobs: { ...record.blobs, [blobId]: descriptor },
  };
}

export function commitEnvironmentRevision(
  record: EnvironmentRecord,
  revisionId: string,
  now: Date,
): EnvironmentRecord {
  assertActive(record, now);
  const revision = requiredRevision(record, revisionId);
  if (revision.status === "committed") return record;
  const expectedParent = record.currentRevisionId ?? undefined;
  if (revision.request.parentRevisionId !== expectedParent) {
    throw new EnvironmentStateError(
      "CONFLICT",
      "Environment moved since revision reservation",
    );
  }
  if (!revision.manifestUploaded) {
    throw new EnvironmentStateError(
      "CONFLICT",
      "Revision manifest has not been uploaded",
    );
  }
  for (const blob of revision.request.blobs) {
    const stored = record.blobs[blob.blobId];
    if (stored === undefined) {
      throw new EnvironmentStateError(
        "CONFLICT",
        `Revision blob ${blob.blobId} has not been uploaded`,
      );
    }
    assertDescriptorMatches(blob, stored, `Revision blob ${blob.blobId}`);
  }
  return {
    ...record,
    currentRevisionId: revisionId,
    revisions: {
      ...record.revisions,
      [revisionId]: { ...revision, status: "committed" },
    },
  };
}

export function addEnvironmentProposal(
  record: EnvironmentRecord,
  input: ProposalDescriptor,
  now: Date,
): EnvironmentRecord {
  assertActive(record, now);
  if (record.proposalTokenDigest === undefined) {
    throw new EnvironmentStateError(
      "NOT_FOUND",
      "Environment does not accept proposals",
    );
  }
  const descriptor = proposalDescriptorSchema.parse(input);
  if (record.revisions[descriptor.baseRevisionId]?.status !== "committed") {
    throw new EnvironmentStateError(
      "CONFLICT",
      "Proposal base revision is not committed",
    );
  }
  const existing = record.proposals[descriptor.proposalId];
  if (existing !== undefined) {
    if (JSON.stringify(existing.descriptor) === JSON.stringify(descriptor))
      return record;
    throw new EnvironmentStateError(
      "CONFLICT",
      "Proposal id already exists with different ciphertext",
    );
  }
  return {
    ...record,
    proposals: {
      ...record.proposals,
      [descriptor.proposalId]: { descriptor, status: "pending" },
    },
  };
}

export function setEnvironmentProposalStatus(
  record: EnvironmentRecord,
  proposalId: string,
  status: Exclude<ProposalStatus, "pending">,
  now: Date,
): EnvironmentRecord {
  assertActive(record, now);
  const proposal = record.proposals[proposalId];
  if (proposal === undefined)
    throw new EnvironmentStateError("NOT_FOUND", "Proposal not found");
  if (proposal.status !== "pending" && proposal.status !== status) {
    throw new EnvironmentStateError(
      "CONFLICT",
      "Proposal already has a different terminal status",
    );
  }
  if (proposal.status === status) return record;
  return {
    ...record,
    proposals: {
      ...record.proposals,
      [proposalId]: { ...proposal, status },
    },
  };
}

export function revokeEnvironment(
  record: EnvironmentRecord,
): EnvironmentRecord {
  if (record.status === "revoked") return record;
  return { ...record, status: "revoked" };
}

function requiredRevision(
  record: EnvironmentRecord,
  revisionId: string,
): EnvironmentRevisionRecord {
  const revision = record.revisions[revisionId];
  if (revision === undefined)
    throw new EnvironmentStateError("NOT_FOUND", "Revision not found");
  return revision;
}

function assertDescriptorMatches(
  expected: CiphertextDescriptor,
  received: CiphertextDescriptor,
  label: string,
): void {
  if (
    expected.ciphertextSha256 !== received.ciphertextSha256 ||
    expected.ciphertextBytes !== received.ciphertextBytes
  ) {
    throw new EnvironmentStateError("CONFLICT", `${label} descriptor mismatch`);
  }
}

function assertActive(record: EnvironmentRecord, now: Date): void {
  const status = effectiveEnvironmentStatus(record, now);
  if (status === "expired")
    throw new EnvironmentStateError("EXPIRED", "Environment expired");
  if (status === "revoked")
    throw new EnvironmentStateError("REVOKED", "Environment revoked");
}
