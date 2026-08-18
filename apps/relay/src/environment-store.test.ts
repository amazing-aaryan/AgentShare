import { describe, expect, it } from "vitest";
import { capabilityDigest, sha256Hex } from "@agentshare/acb";
import { InMemoryEnvironmentStore, RelayStoreError } from "./environment-store.js";

const now = new Date("2026-08-19T00:00:00.000Z");
const read = "read_" + "r".repeat(40);
const update = "update_" + "u".repeat(38);
const propose = "propose_" + "p".repeat(37);
const inbox = "inbox_" + "i".repeat(39);
const revoke = "revoke_" + "v".repeat(38);

function createStore(): InMemoryEnvironmentStore {
  const store = new InMemoryEnvironmentStore();
  store.create(
    {
      environmentId: "env_12345678901234567890",
      requestedTtlSeconds: 86400,
      readTokenDigest: capabilityDigest(read),
      updateTokenDigest: capabilityDigest(update),
      proposalTokenDigest: capabilityDigest(propose),
      inboxTokenDigest: capabilityDigest(inbox),
      revokeTokenDigest: capabilityDigest(revoke),
    },
    now,
  );
  return store;
}

function commitFirst(store: InMemoryEnvironmentStore): void {
  const manifest = Buffer.from("manifest");
  const blob = Buffer.from("blob");
  store.reserveRevision(
    "env_12345678901234567890",
    update,
    {
      revisionId: "rev_12345678901234567890",
      manifest: { ciphertextSha256: sha256Hex(manifest), ciphertextBytes: manifest.byteLength },
      blobs: [
        {
          blobId: "blob_12345678901234567890",
          ciphertextSha256: sha256Hex(blob),
          ciphertextBytes: blob.byteLength,
        },
      ],
    },
    now,
  );
  store.uploadManifest("env_12345678901234567890", "rev_12345678901234567890", update, manifest, now);
  store.uploadBlob("env_12345678901234567890", "blob_12345678901234567890", update, blob, now);
  store.commitRevision("env_12345678901234567890", "rev_12345678901234567890", update, now);
}

describe("InMemoryEnvironmentStore", () => {
  it("separates read and update capabilities", () => {
    const store = createStore();
    expect(store.metadata("env_12345678901234567890", read, now).environmentId).toBe("env_12345678901234567890");
    expect(() => store.reserveRevision("env_12345678901234567890", read, {
      revisionId: "rev_12345678901234567890",
      manifest: { ciphertextSha256: "a".repeat(64), ciphertextBytes: 1 },
      blobs: [],
    }, now)).toThrow(RelayStoreError);
  });

  it("lets proposers submit encrypted bytes but not inspect the owner inbox", () => {
    const store = createStore();
    commitFirst(store);
    const ciphertext = Buffer.from("encrypted-proposal");
    store.submitProposal(
      "env_12345678901234567890",
      propose,
      {
        proposalId: "prop_12345678901234567890",
        baseRevisionId: "rev_12345678901234567890",
        ciphertextSha256: sha256Hex(ciphertext),
        ciphertextBytes: ciphertext.byteLength,
        ephemeralPublicKey: "k".repeat(43),
      },
      ciphertext,
      now,
    );
    expect(() => store.listProposals("env_12345678901234567890", propose, now)).toThrow(RelayStoreError);
    expect(store.listProposals("env_12345678901234567890", inbox, now)).toHaveLength(1);
    expect(Buffer.from(store.downloadProposal("env_12345678901234567890", "prop_12345678901234567890", inbox, now)).toString()).toBe("encrypted-proposal");
  });
});
