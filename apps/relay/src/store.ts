import { timingSafeEqual } from "node:crypto";
import { capabilityDigest } from "@agentshare/acb";
import {
  type CreateShareRequest,
  type RelayRecord,
  type UploadDescriptor,
} from "@agentshare/contracts";
import {
  createRecord,
  effectiveStatus,
  revokeRecord,
  uploadRecord,
} from "@agentshare/contracts/relay-machine";

export type StoredShare = {
  record: RelayRecord;
  blob?: Uint8Array;
};

export class RelayStoreError extends Error {
  constructor(
    readonly code:
      "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT" | "EXPIRED" | "REVOKED",
    message: string,
  ) {
    super(message);
    this.name = "RelayStoreError";
  }
}

export class InMemoryRelayStore {
  readonly #shares = new Map<string, StoredShare>();

  create(request: CreateShareRequest, now: Date): RelayRecord {
    const existing = this.#shares.get(request.shareId);
    if (existing !== undefined) {
      const status = effectiveStatus(existing.record, now);
      if (status === "expired" || status === "revoked") {
        throw new RelayStoreError(
          "CONFLICT",
          "Share ID has already been consumed",
        );
      }
      const same =
        existing.record.uploadTokenDigest === request.uploadTokenDigest &&
        existing.record.readTokenDigest === request.readTokenDigest &&
        existing.record.revokeTokenDigest === request.revokeTokenDigest;
      if (same) return existing.record;
      throw new RelayStoreError("CONFLICT", "Share ID already exists");
    }
    const record = createRecord(request, now);
    this.#shares.set(request.shareId, { record });
    return record;
  }

  metadata(shareId: string, readCapability: string, now: Date): RelayRecord {
    const share = this.#required(shareId);
    this.#authorize(share.record.readTokenDigest, readCapability);
    const status = effectiveStatus(share.record, now);
    if (status === "expired")
      throw new RelayStoreError("EXPIRED", "Share expired");
    if (status === "revoked")
      throw new RelayStoreError("REVOKED", "Share revoked");
    return { ...share.record, status };
  }

  upload(
    shareId: string,
    uploadCapability: string,
    descriptor: UploadDescriptor,
    blob: Uint8Array,
    now: Date,
  ): RelayRecord {
    const share = this.#required(shareId);
    this.#authorize(share.record.uploadTokenDigest, uploadCapability);
    const record = uploadRecord(share.record, descriptor, now);
    share.blob ??= Buffer.from(blob);
    share.record = record;
    return record;
  }

  download(shareId: string, readCapability: string, now: Date): Uint8Array {
    const share = this.#required(shareId);
    this.metadata(shareId, readCapability, now);
    if (share.record.status !== "available" || share.blob === undefined) {
      throw new RelayStoreError("NOT_FOUND", "Ciphertext is not available");
    }
    return Buffer.from(share.blob);
  }

  revoke(shareId: string, revokeCapability: string): RelayRecord {
    const share = this.#required(shareId);
    this.#authorize(share.record.revokeTokenDigest, revokeCapability);
    share.record = revokeRecord(share.record);
    delete share.blob;
    return share.record;
  }

  #required(shareId: string): StoredShare {
    const share = this.#shares.get(shareId);
    if (share === undefined)
      throw new RelayStoreError("NOT_FOUND", "Share not found");
    return share;
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
}
