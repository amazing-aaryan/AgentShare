import { describe, expect, it } from "vitest";
import {
  createRecord,
  effectiveStatus,
  RelayStateError,
  revokeRecord,
  uploadRecord,
} from "./relay-machine.js";

const request = {
  shareId: "abcdefghijklmnopqrstuvwx",
  requestedTtlSeconds: 60,
  uploadTokenDigest: "a".repeat(64),
  readTokenDigest: "b".repeat(64),
  revokeTokenDigest: "c".repeat(64),
} as const;
const upload = {
  ciphertextSha256: "d".repeat(64),
  ciphertextBytes: 100,
} as const;

describe("relay state machine", () => {
  it("creates authoritative metadata and awaits upload", () => {
    const record = createRecord(request, new Date("2026-08-08T12:00:00.000Z"));
    expect(record.status).toBe("awaiting-upload");
    expect(record.metadata.expiresAt).toBe("2026-08-08T12:01:00.000Z");
  });

  it("makes identical upload retries idempotent", () => {
    const record = createRecord(request, new Date("2026-08-08T12:00:00.000Z"));
    const first = uploadRecord(
      record,
      upload,
      new Date("2026-08-08T12:00:01.000Z"),
    );
    expect(
      uploadRecord(first, upload, new Date("2026-08-08T12:00:02.000Z")),
    ).toBe(first);
  });

  it("rejects overwrite with different ciphertext", () => {
    const record = uploadRecord(
      createRecord(request, new Date("2026-08-08T12:00:00.000Z")),
      upload,
      new Date("2026-08-08T12:00:01.000Z"),
    );
    expect(() =>
      uploadRecord(
        record,
        { ...upload, ciphertextSha256: "e".repeat(64) },
        new Date("2026-08-08T12:00:02.000Z"),
      ),
    ).toThrow(RelayStateError);
  });

  it("makes revoke idempotent and terminal", () => {
    const record = createRecord(request, new Date("2026-08-08T12:00:00.000Z"));
    const revoked = revokeRecord(record);
    expect(revokeRecord(revoked)).toBe(revoked);
    expect(effectiveStatus(revoked, new Date("2026-08-08T12:00:01.000Z"))).toBe(
      "revoked",
    );
  });

  it("computes expiry from authoritative time", () => {
    const record = createRecord(request, new Date("2026-08-08T12:00:00.000Z"));
    expect(effectiveStatus(record, new Date("2026-08-08T12:01:00.000Z"))).toBe(
      "expired",
    );
  });
});
