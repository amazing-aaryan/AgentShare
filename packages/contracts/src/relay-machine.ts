import {
  MAX_CIPHERTEXT_BYTES,
  MAX_TTL_SECONDS,
  PROTOCOL_VERSION,
  type AuthoritativeMetadata,
  type CreateShareRequest,
  type RelayRecord,
  type ShareStatus,
  type UploadDescriptor,
} from "./index.js";

export class RelayStateError extends Error {
  constructor(
    readonly code:
      "NOT_FOUND" | "CONFLICT" | "EXPIRED" | "REVOKED" | "PAYLOAD_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "RelayStateError";
  }
}

export function createRecord(
  request: CreateShareRequest,
  now: Date,
): RelayRecord {
  const ttl = Math.min(request.requestedTtlSeconds, MAX_TTL_SECONDS);
  const metadata: AuthoritativeMetadata = {
    protocolVersion: PROTOCOL_VERSION,
    shareId: request.shareId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    limits: {
      maxCiphertextBytes: MAX_CIPHERTEXT_BYTES,
      maxTtlSeconds: MAX_TTL_SECONDS,
    },
  };

  return {
    metadata,
    uploadTokenDigest: request.uploadTokenDigest,
    readTokenDigest: request.readTokenDigest,
    revokeTokenDigest: request.revokeTokenDigest,
    status: "awaiting-upload",
  };
}

export function effectiveStatus(record: RelayRecord, now: Date): ShareStatus {
  if (record.status === "revoked") return "revoked";
  if (now.getTime() >= Date.parse(record.metadata.expiresAt)) return "expired";
  return record.status;
}

export function uploadRecord(
  record: RelayRecord,
  upload: UploadDescriptor,
  now: Date,
): RelayRecord {
  const status = effectiveStatus(record, now);
  if (status === "expired")
    throw new RelayStateError("EXPIRED", "Share expired");
  if (status === "revoked")
    throw new RelayStateError("REVOKED", "Share revoked");
  if (upload.ciphertextBytes > MAX_CIPHERTEXT_BYTES) {
    throw new RelayStateError(
      "PAYLOAD_TOO_LARGE",
      "Ciphertext exceeds relay limit",
    );
  }
  if (record.status === "available") {
    if (
      record.upload?.ciphertextSha256 === upload.ciphertextSha256 &&
      record.upload.ciphertextBytes === upload.ciphertextBytes
    ) {
      return record;
    }
    throw new RelayStateError(
      "CONFLICT",
      "Share already contains another blob",
    );
  }

  return { ...record, status: "available", upload };
}

export function revokeRecord(record: RelayRecord): RelayRecord {
  if (record.status === "revoked") return record;
  return { ...record, status: "revoked" };
}
