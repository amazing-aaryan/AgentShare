import { describe, expect, it } from "vitest";
import {
  decryptProposalForOwner,
  encryptProposalForOwner,
  generateProposalKeyPair,
} from "./proposal-crypto.js";

describe("proposal crypto", () => {
  it("lets only the creator private key decrypt a proposal", () => {
    const owner = generateProposalKeyPair();
    const encrypted = encryptProposalForOwner(Buffer.from("proposal"), owner.publicKey, {
      environmentId: "env_12345678901234567890",
      proposalId: "prop_12345678901234567890",
    });
    expect(Buffer.from(decryptProposalForOwner(encrypted, owner.privateKey)).toString()).toBe("proposal");
    const other = generateProposalKeyPair();
    expect(() => decryptProposalForOwner(encrypted, other.privateKey)).toThrow();
  });

  it("binds environment and proposal identifiers", () => {
    const owner = generateProposalKeyPair();
    const encrypted = encryptProposalForOwner(Buffer.from("proposal"), owner.publicKey, {
      environmentId: "env_12345678901234567890",
      proposalId: "prop_12345678901234567890",
    });
    expect(() =>
      decryptProposalForOwner({ ...encrypted, proposalId: "prop_other_123456789012345" }, owner.privateKey),
    ).toThrow();
  });
});
