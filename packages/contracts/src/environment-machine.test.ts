import { describe, expect, it } from "vitest";
import {
  commitEnvironmentRevision,
  createEnvironmentRecord,
  recordEnvironmentBlob,
  recordEnvironmentManifest,
  reserveEnvironmentRevision,
  EnvironmentStateError,
} from "./environment-machine.js";

const digest = "d".repeat(64);
const now = new Date("2026-08-19T00:00:00.000Z");

function create() {
  return createEnvironmentRecord(
    {
      environmentId: "env_12345678901234567890",
      requestedTtlSeconds: 86400,
      readTokenDigest: digest,
      updateTokenDigest: digest,
      proposalTokenDigest: digest,
      inboxTokenDigest: digest,
      revokeTokenDigest: digest,
    },
    now,
  );
}

function revision(parentRevisionId?: string) {
  return {
    revisionId:
      parentRevisionId === undefined
        ? "rev_11111111111111111111"
        : "rev_22222222222222222222",
    ...(parentRevisionId === undefined ? {} : { parentRevisionId }),
    manifest: { ciphertextSha256: digest, ciphertextBytes: 80 },
    blobs: [
      {
        blobId: "blob_1111111111111111111",
        ciphertextSha256: digest,
        ciphertextBytes: 120,
      },
    ],
  };
}

describe("environment relay state machine", () => {
  it("commits a revision only after every declared object exists", () => {
    let record = reserveEnvironmentRevision(create(), revision(), now);
    expect(() =>
      commitEnvironmentRevision(record, "rev_11111111111111111111", now),
    ).toThrow(EnvironmentStateError);
    record = recordEnvironmentManifest(
      record,
      "rev_11111111111111111111",
      { ciphertextSha256: digest, ciphertextBytes: 80 },
      now,
    );
    record = recordEnvironmentBlob(
      record,
      "blob_1111111111111111111",
      { ciphertextSha256: digest, ciphertextBytes: 120 },
      now,
    );
    record = commitEnvironmentRevision(record, "rev_11111111111111111111", now);
    expect(record.currentRevisionId).toBe("rev_11111111111111111111");
    expect(record.revisions["rev_11111111111111111111"]?.status).toBe(
      "committed",
    );
  });

  it("keeps an identical revision reservation idempotent after commit", () => {
    const request = revision();
    let record = reserveEnvironmentRevision(create(), request, now);
    record = recordEnvironmentManifest(
      record,
      request.revisionId,
      request.manifest,
      now,
    );
    record = recordEnvironmentBlob(
      record,
      request.blobs[0]?.blobId ?? "missing",
      request.blobs[0] ?? {
        blobId: "missing",
        ciphertextSha256: digest,
        ciphertextBytes: 120,
      },
      now,
    );
    record = commitEnvironmentRevision(record, request.revisionId, now);

    expect(reserveEnvironmentRevision(record, request, now)).toEqual(record);
  });

  it("rejects a stale parent revision", () => {
    let record = reserveEnvironmentRevision(create(), revision(), now);
    record = recordEnvironmentManifest(
      record,
      "rev_11111111111111111111",
      { ciphertextSha256: digest, ciphertextBytes: 80 },
      now,
    );
    record = recordEnvironmentBlob(
      record,
      "blob_1111111111111111111",
      { ciphertextSha256: digest, ciphertextBytes: 120 },
      now,
    );
    record = commitEnvironmentRevision(record, "rev_11111111111111111111", now);
    expect(() =>
      reserveEnvironmentRevision(
        record,
        revision("rev_stale_123456789012345"),
        now,
      ),
    ).toThrow(EnvironmentStateError);
  });

  it("allows idempotent identical blob descriptors and rejects replacement", () => {
    let record = reserveEnvironmentRevision(create(), revision(), now);
    record = recordEnvironmentBlob(
      record,
      "blob_1111111111111111111",
      { ciphertextSha256: digest, ciphertextBytes: 120 },
      now,
    );
    expect(
      recordEnvironmentBlob(
        record,
        "blob_1111111111111111111",
        { ciphertextSha256: digest, ciphertextBytes: 120 },
        now,
      ),
    ).toEqual(record);
    expect(() =>
      recordEnvironmentBlob(
        record,
        "blob_1111111111111111111",
        { ciphertextSha256: "e".repeat(64), ciphertextBytes: 120 },
        now,
      ),
    ).toThrow(EnvironmentStateError);
  });
});