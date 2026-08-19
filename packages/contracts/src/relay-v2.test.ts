import { describe, expect, it } from "vitest";
import {
  createEnvironmentRequestSchema,
  reserveRevisionRequestSchema,
  proposalStatusRequestSchema,
} from "./relay-v2.js";

const digest = "c".repeat(64);

describe("v2 relay schemas", () => {
  it("requires all creator and recipient capability digests", () => {
    expect(
      createEnvironmentRequestSchema.parse({
        environmentId: "env_12345678901234567890",
        requestedTtlSeconds: 86400,
        readTokenDigest: digest,
        updateTokenDigest: digest,
        proposalTokenDigest: digest,
        inboxTokenDigest: digest,
        revokeTokenDigest: digest,
      }).requestedTtlSeconds,
    ).toBe(86400);
  });

  it("rejects revisions that claim the same parent and revision id", () => {
    expect(() =>
      reserveRevisionRequestSchema.parse({
        revisionId: "rev_12345678901234567890",
        parentRevisionId: "rev_12345678901234567890",
        manifest: { ciphertextSha256: digest, ciphertextBytes: 100 },
        blobs: [],
      }),
    ).toThrow();
  });

  it.each(["accepted", "rejected"])(
    "accepts terminal proposal status %s",
    (status) => {
      expect(proposalStatusRequestSchema.parse({ status }).status).toBe(status);
    },
  );

  it("rejects pending as a client-set proposal status", () => {
    expect(() =>
      proposalStatusRequestSchema.parse({ status: "pending" }),
    ).toThrow();
  });
});
