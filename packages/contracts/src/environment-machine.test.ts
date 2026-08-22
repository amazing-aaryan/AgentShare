import { describe, expect, it } from "vitest";
import {
  addEnvironmentProposal,
  commitEnvironmentRevision,
  createEnvironmentRecord,
  effectiveEnvironmentStatus,
  EnvironmentStateError,
  recordEnvironmentBlob,
  recordEnvironmentManifest,
  reserveEnvironmentRevision,
  revokeEnvironment,
  setEnvironmentProposalStatus,
} from "./environment-machine.js";

const digest = "d".repeat(64);
const otherDigest = "e".repeat(64);
const now = new Date("2026-08-19T00:00:00.000Z");

function create(options: { proposals?: boolean } = {}) {
  const proposals = options.proposals ?? true;
  return createEnvironmentRecord(
    {
      environmentId: "env_12345678901234567890",
      requestedTtlSeconds: 86400,
      readTokenDigest: digest,
      updateTokenDigest: digest,
      ...(proposals ? { proposalTokenDigest: digest } : {}),
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

function commitBase(record = create()) {
  const request = revision();
  let next = reserveEnvironmentRevision(record, request, now);
  next = recordEnvironmentManifest(next, request.revisionId, request.manifest, now);
  next = recordEnvironmentBlob(
    next,
    request.blobs[0]?.blobId ?? "missing",
    request.blobs[0] ?? {
      blobId: "missing",
      ciphertextSha256: digest,
      ciphertextBytes: 120,
    },
    now,
  );
  return commitEnvironmentRevision(next, request.revisionId, now);
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "prop_12345678901234567890",
    baseRevisionId: "rev_11111111111111111111",
    ciphertextSha256: digest,
    ciphertextBytes: 64,
    ephemeralPublicKey: "k".repeat(43),
    ...overrides,
  };
}

function expectStateError(
  run: () => unknown,
  code: EnvironmentStateError["code"],
): void {
  try {
    run();
    throw new Error("Expected EnvironmentStateError");
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentStateError);
    expect((error as EnvironmentStateError).code).toBe(code);
  }
}

describe("environment relay state machine", () => {
  it("commits a revision only after every declared object exists", () => {
    let record = reserveEnvironmentRevision(create(), revision(), now);
    expectStateError(
      () => commitEnvironmentRevision(record, "rev_11111111111111111111", now),
      "CONFLICT",
    );
    record = recordEnvironmentManifest(
      record,
      "rev_11111111111111111111",
      { ciphertextSha256: digest, ciphertextBytes: 80 },
      now,
    );
    expectStateError(
      () => commitEnvironmentRevision(record, "rev_11111111111111111111", now),
      "CONFLICT",
    );
    record = recordEnvironmentBlob(
      record,
      "blob_1111111111111111111",
      { ciphertextSha256: digest, ciphertextBytes: 120 },
      now,
    );
    record = commitEnvironmentRevision(record, "rev_11111111111111111111", now);
    expect(record.currentRevisionId).toBe("rev_11111111111111111111");
    expect(record.revisions.rev_11111111111111111111?.status).toBe("committed");
    expect(
      commitEnvironmentRevision(record, "rev_11111111111111111111", now),
    ).toEqual(record);
  });

  it("keeps an identical revision reservation idempotent after commit", () => {
    const request = revision();
    const record = commitBase();
    expect(reserveEnvironmentRevision(record, request, now)).toEqual(record);
  });

  it("rejects conflicting duplicate revisions and stale parents", () => {
    const request = revision();
    const reserved = reserveEnvironmentRevision(create(), request, now);
    expectStateError(
      () =>
        reserveEnvironmentRevision(
          reserved,
          {
            ...request,
            manifest: { ciphertextSha256: otherDigest, ciphertextBytes: 80 },
          },
          now,
        ),
      "CONFLICT",
    );

    const committed = commitBase();
    expectStateError(
      () =>
        reserveEnvironmentRevision(
          committed,
          revision("rev_stale_123456789012345"),
          now,
        ),
      "CONFLICT",
    );
  });

  it("validates revision manifest descriptors and missing revisions", () => {
    const request = revision();
    const record = reserveEnvironmentRevision(create(), request, now);
    expectStateError(
      () =>
        recordEnvironmentManifest(
          record,
          "rev_missing_123456789012345",
          request.manifest,
          now,
        ),
      "NOT_FOUND",
    );
    expectStateError(
      () =>
        recordEnvironmentManifest(
          record,
          request.revisionId,
          { ciphertextSha256: otherDigest, ciphertextBytes: 80 },
          now,
        ),
      "CONFLICT",
    );
    const uploaded = recordEnvironmentManifest(
      record,
      request.revisionId,
      request.manifest,
      now,
    );
    expect(
      recordEnvironmentManifest(uploaded, request.revisionId, request.manifest, now),
    ).toEqual(uploaded);
  });

  it("allows identical blobs while rejecting undeclared and mismatched blobs", () => {
    const request = revision();
    let record = reserveEnvironmentRevision(create(), request, now);
    expectStateError(
      () =>
        recordEnvironmentBlob(
          record,
          "blob_missing_12345678901234",
          { ciphertextSha256: digest, ciphertextBytes: 120 },
          now,
        ),
      "NOT_FOUND",
    );
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
    expectStateError(
      () =>
        recordEnvironmentBlob(
          record,
          "blob_1111111111111111111",
          { ciphertextSha256: otherDigest, ciphertextBytes: 120 },
          now,
        ),
      "CONFLICT",
    );
    expectStateError(
      () =>
        recordEnvironmentBlob(
          record,
          "blob_1111111111111111111",
          { ciphertextSha256: digest, ciphertextBytes: 121 },
          now,
        ),
      "CONFLICT",
    );
  });

  it("rejects committing a revision after the environment head moves", () => {
    const base = commitBase();
    const next = revision("rev_11111111111111111111");
    let record = reserveEnvironmentRevision(base, next, now);
    record = recordEnvironmentManifest(record, next.revisionId, next.manifest, now);
    record = recordEnvironmentBlob(
      record,
      next.blobs[0]?.blobId ?? "missing",
      next.blobs[0] ?? {
        blobId: "missing",
        ciphertextSha256: digest,
        ciphertextBytes: 120,
      },
      now,
    );
    const moved = {
      ...record,
      currentRevisionId: "rev_other_1234567890123456",
    };
    expectStateError(
      () => commitEnvironmentRevision(moved, next.revisionId, now),
      "CONFLICT",
    );
  });

  it("tracks active, expired, and revoked status and fails closed", () => {
    const record = create();
    expect(effectiveEnvironmentStatus(record, now)).toBe("active");
    const afterExpiry = new Date(Date.parse(record.expiresAt) + 1);
    expect(effectiveEnvironmentStatus(record, afterExpiry)).toBe("expired");
    expectStateError(
      () => reserveEnvironmentRevision(record, revision(), afterExpiry),
      "EXPIRED",
    );

    const explicitlyExpired = { ...record, status: "expired" as const };
    expect(effectiveEnvironmentStatus(explicitlyExpired, now)).toBe("expired");

    const revoked = revokeEnvironment(record);
    expect(revoked.status).toBe("revoked");
    expect(revokeEnvironment(revoked)).toEqual(revoked);
    expect(effectiveEnvironmentStatus(revoked, now)).toBe("revoked");
    expectStateError(
      () => reserveEnvironmentRevision(revoked, revision(), now),
      "REVOKED",
    );
  });

  it("omits proposal capability when proposals are disabled", () => {
    const record = create({ proposals: false });
    expect(record.proposalTokenDigest).toBeUndefined();
    const committed = commitBase(record);
    expectStateError(
      () => addEnvironmentProposal(committed, proposal(), now),
      "NOT_FOUND",
    );
  });

  it("requires proposals to target committed revisions", () => {
    expectStateError(
      () => addEnvironmentProposal(create(), proposal(), now),
      "CONFLICT",
    );
  });

  it("adds proposals idempotently and rejects conflicting reuse", () => {
    const committed = commitBase();
    const descriptor = proposal();
    const added = addEnvironmentProposal(committed, descriptor, now);
    expect(added.proposals.prop_12345678901234567890?.status).toBe("pending");
    expect(addEnvironmentProposal(added, descriptor, now)).toEqual(added);
    expectStateError(
      () =>
        addEnvironmentProposal(
          added,
          proposal({ ciphertextSha256: otherDigest }),
          now,
        ),
      "CONFLICT",
    );
  });

  it("enforces proposal terminal-state transitions", () => {
    const added = addEnvironmentProposal(commitBase(), proposal(), now);
    expectStateError(
      () =>
        setEnvironmentProposalStatus(
          added,
          "prop_missing_12345678901234",
          "accepted",
          now,
        ),
      "NOT_FOUND",
    );

    const accepted = setEnvironmentProposalStatus(
      added,
      "prop_12345678901234567890",
      "accepted",
      now,
    );
    expect(accepted.proposals.prop_12345678901234567890?.status).toBe(
      "accepted",
    );
    expect(
      setEnvironmentProposalStatus(
        accepted,
        "prop_12345678901234567890",
        "accepted",
        now,
      ),
    ).toEqual(accepted);
    expectStateError(
      () =>
        setEnvironmentProposalStatus(
          accepted,
          "prop_12345678901234567890",
          "rejected",
          now,
        ),
      "CONFLICT",
    );
  });
});
