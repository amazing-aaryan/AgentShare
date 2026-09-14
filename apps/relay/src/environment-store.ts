import { timingSafeEqual } from "node:crypto";
import { capabilityDigest, sha256Hex } from "@agentshare/acb";
import {
  addEnvironmentProposal,
  commitEnvironmentRevision,
  createEnvironmentRecord,
  effectiveEnvironmentStatus,
  recordEnvironmentBlob,
  recordEnvironmentManifest,
  reserveEnvironmentRevision,
  revokeEnvironment,
  setEnvironmentProposalStatus,
  type CiphertextDescriptor,
  type CreateEnvironmentRequest,
  type EnvironmentProposalRecord,
  type EnvironmentRecord,
  type ProposalDescriptor,
  type ReserveRevisionRequest,
} from "@agentshare/contracts";

export class RelayStoreError extends Error {
  constructor(
    readonly code:
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "CONFLICT"
      | "EXPIRED"
      | "REVOKED"
      | "PAYLOAD_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "RelayStoreError";
  }
}

type StoredEnvironment = {
  record: EnvironmentRecord;
  manifests: Map<string, Uint8Array>;
  blobs: Map<string, Uint8Array>;
  proposals: Map<string, Uint8Array>;
};

export class InMemoryEnvironmentStore {
  readonly #environments = new Map<string, StoredEnvironment>();

  create(request: CreateEnvironmentRequest, now: Date): EnvironmentRecord {
    const existing = this.#environments.get(request.environmentId);
    if (existing !== undefined) {
      const status = effectiveEnvironmentStatus(existing.record, now);
      if (status !== "active")
        throw new RelayStoreError(
          "CONFLICT",
          "Environment ID has already been consumed",
        );
      const same =
        existing.record.readTokenDigest === request.readTokenDigest &&
        existing.record.updateTokenDigest === request.updateTokenDigest &&
        existing.record.proposalTokenDigest === request.proposalTokenDigest &&
        existing.record.inboxTokenDigest === request.inboxTokenDigest &&
        existing.record.revokeTokenDigest === request.revokeTokenDigest;
      if (same) return existing.record;
      throw new RelayStoreError("CONFLICT", "Environment ID already exists");
    }
    const record = createEnvironmentRecord(request, now);
    this.#environments.set(request.environmentId, {
      record,
      manifests: new Map(),
      blobs: new Map(),
      proposals: new Map(),
    });
    return record;
  }

  metadata(
    environmentId: string,
    readCapability: string,
    now: Date,
  ): EnvironmentRecord {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.readTokenDigest, readCapability);
    this.#assertActive(environment.record, now);
    return environment.record;
  }

  reserveRevision(
    environmentId: string,
    updateCapability: string,
    request: ReserveRevisionRequest,
    now: Date,
  ): EnvironmentRecord {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.updateTokenDigest, updateCapability);
    environment.record = this.#mapState(() =>
      reserveEnvironmentRevision(environment.record, request, now),
    );
    return environment.record;
  }

  uploadManifest(
    environmentId: string,
    revisionId: string,
    updateCapability: string,
    bytes: Uint8Array,
    now: Date,
  ): EnvironmentRecord {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.updateTokenDigest, updateCapability);
    const descriptor = descriptorFor(bytes);
    const existing = environment.manifests.get(revisionId);
    if (existing !== undefined) {
      if (
        sha256Hex(existing) !== descriptor.ciphertextSha256 ||
        existing.byteLength !== descriptor.ciphertextBytes
      ) {
        throw new RelayStoreError(
          "CONFLICT",
          "Revision manifest already contains different ciphertext",
        );
      }
    }
    environment.record = this.#mapState(() =>
      recordEnvironmentManifest(
        environment.record,
        revisionId,
        descriptor,
        now,
      ),
    );
    environment.manifests.set(revisionId, Buffer.from(bytes));
    return environment.record;
  }

  uploadBlob(
    environmentId: string,
    blobId: string,
    updateCapability: string,
    bytes: Uint8Array,
    now: Date,
  ): EnvironmentRecord {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.updateTokenDigest, updateCapability);
    const descriptor = descriptorFor(bytes);
    const existing = environment.blobs.get(blobId);
    if (existing !== undefined) {
      if (
        sha256Hex(existing) !== descriptor.ciphertextSha256 ||
        existing.byteLength !== descriptor.ciphertextBytes
      ) {
        throw new RelayStoreError(
          "CONFLICT",
          "Environment blob already contains different ciphertext",
        );
      }
    }
    environment.record = this.#mapState(() =>
      recordEnvironmentBlob(environment.record, blobId, descriptor, now),
    );
    environment.blobs.set(blobId, Buffer.from(bytes));
    return environment.record;
  }

  commitRevision(
    environmentId: string,
    revisionId: string,
    updateCapability: string,
    now: Date,
  ): EnvironmentRecord {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.updateTokenDigest, updateCapability);
    environment.record = this.#mapState(() =>
      commitEnvironmentRevision(environment.record, revisionId, now),
    );
    return environment.record;
  }

  downloadManifest(
    environmentId: string,
    revisionId: string,
    readCapability: string,
    now: Date,
  ): Uint8Array {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.readTokenDigest, readCapability);
    this.#assertActive(environment.record, now);
    if (environment.record.revisions[revisionId]?.status !== "committed") {
      throw new RelayStoreError("NOT_FOUND", "Committed revision not found");
    }
    const bytes = environment.manifests.get(revisionId);
    if (bytes === undefined)
      throw new RelayStoreError(
        "NOT_FOUND",
        "Revision manifest is unavailable",
      );
    return Buffer.from(bytes);
  }

  downloadBlob(
    environmentId: string,
    blobId: string,
    readCapability: string,
    now: Date,
  ): Uint8Array {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.readTokenDigest, readCapability);
    this.#assertActive(environment.record, now);
    const referencedByCommittedRevision = Object.values(
      environment.record.revisions,
    ).some(
      (revision) =>
        revision.status === "committed" &&
        revision.request.blobs.some((blob) => blob.blobId === blobId),
    );
    if (!referencedByCommittedRevision)
      throw new RelayStoreError(
        "NOT_FOUND",
        "Environment blob is not committed",
      );
    const bytes = environment.blobs.get(blobId);
    if (bytes === undefined)
      throw new RelayStoreError("NOT_FOUND", "Environment blob is unavailable");
    return Buffer.from(bytes);
  }

  submitProposal(
    environmentId: string,
    proposalCapability: string,
    descriptor: ProposalDescriptor,
    bytes: Uint8Array,
    now: Date,
  ): EnvironmentRecord {
    const environment = this.#required(environmentId);
    if (environment.record.proposalTokenDigest === undefined) {
      throw new RelayStoreError(
        "NOT_FOUND",
        "Environment does not accept proposals",
      );
    }
    this.#authorize(environment.record.proposalTokenDigest, proposalCapability);
    this.#assertActive(environment.record, now);
    assertBytesMatch(descriptor, bytes, "Proposal ciphertext");
    const existing = environment.proposals.get(descriptor.proposalId);
    if (
      existing !== undefined &&
      sha256Hex(existing) !== descriptor.ciphertextSha256
    ) {
      throw new RelayStoreError(
        "CONFLICT",
        "Proposal id already contains different ciphertext",
      );
    }
    environment.record = this.#mapState(() =>
      addEnvironmentProposal(environment.record, descriptor, now),
    );
    environment.proposals.set(descriptor.proposalId, Buffer.from(bytes));
    return environment.record;
  }

  listProposals(
    environmentId: string,
    inboxCapability: string,
    now: Date,
  ): EnvironmentProposalRecord[] {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.inboxTokenDigest, inboxCapability);
    this.#assertActive(environment.record, now);
    return Object.values(environment.record.proposals).sort((a, b) =>
      a.descriptor.proposalId.localeCompare(b.descriptor.proposalId, "en"),
    );
  }

  downloadProposal(
    environmentId: string,
    proposalId: string,
    inboxCapability: string,
    now: Date,
  ): Uint8Array {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.inboxTokenDigest, inboxCapability);
    this.#assertActive(environment.record, now);
    if (environment.record.proposals[proposalId] === undefined) {
      throw new RelayStoreError("NOT_FOUND", "Proposal not found");
    }
    const bytes = environment.proposals.get(proposalId);
    if (bytes === undefined)
      throw new RelayStoreError(
        "NOT_FOUND",
        "Proposal ciphertext is unavailable",
      );
    return Buffer.from(bytes);
  }

  setProposalStatus(
    environmentId: string,
    proposalId: string,
    inboxCapability: string,
    status: "accepted" | "rejected",
    now: Date,
  ): EnvironmentRecord {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.inboxTokenDigest, inboxCapability);
    environment.record = this.#mapState(() =>
      setEnvironmentProposalStatus(environment.record, proposalId, status, now),
    );
    return environment.record;
  }

  revoke(environmentId: string, revokeCapability: string): EnvironmentRecord {
    const environment = this.#required(environmentId);
    this.#authorize(environment.record.revokeTokenDigest, revokeCapability);
    environment.record = revokeEnvironment(environment.record);
    environment.manifests.clear();
    environment.blobs.clear();
    environment.proposals.clear();
    return environment.record;
  }

  #required(environmentId: string): StoredEnvironment {
    const environment = this.#environments.get(environmentId);
    if (environment === undefined)
      throw new RelayStoreError("NOT_FOUND", "Environment not found");
    return environment;
  }

  #authorize(expectedDigest: string, capability: string): void {
    const actual = Buffer.from(capabilityDigest(capability), "hex");
    const expected = Buffer.from(expectedDigest, "hex");
    if (
      actual.byteLength !== expected.byteLength ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new RelayStoreError("UNAUTHORIZED", "Invalid capability");
    }
  }

  #assertActive(record: EnvironmentRecord, now: Date): void {
    const status = effectiveEnvironmentStatus(record, now);
    if (status === "expired")
      throw new RelayStoreError("EXPIRED", "Environment expired");
    if (status === "revoked")
      throw new RelayStoreError("REVOKED", "Environment revoked");
  }

  #mapState<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        const code = String(error.code);
        if (
          [
            "NOT_FOUND",
            "CONFLICT",
            "EXPIRED",
            "REVOKED",
            "PAYLOAD_TOO_LARGE",
          ].includes(code)
        ) {
          throw new RelayStoreError(
            code as RelayStoreError["code"],
            error.message,
          );
        }
      }
      throw error;
    }
  }
}

function descriptorFor(bytes: Uint8Array): CiphertextDescriptor {
  return {
    ciphertextSha256: sha256Hex(bytes),
    ciphertextBytes: bytes.byteLength,
  };
}

function assertBytesMatch(
  descriptor: Pick<
    CiphertextDescriptor,
    "ciphertextSha256" | "ciphertextBytes"
  >,
  bytes: Uint8Array,
  label: string,
): void {
  if (
    bytes.byteLength !== descriptor.ciphertextBytes ||
    sha256Hex(bytes) !== descriptor.ciphertextSha256
  ) {
    throw new RelayStoreError("CONFLICT", `${label} descriptor mismatch`);
  }
}
