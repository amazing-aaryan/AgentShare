import { describe, expect, it } from "vitest";
import { proposalSchema } from "./proposals.js";

const hex = "b".repeat(64);

function baseProposal() {
  return {
    version: "agentshare-proposal-v1",
    proposalId: "prop_12345678901234567890",
    environmentId: "env_12345678901234567890",
    baseRevisionId: "rev_12345678901234567890",
    createdAt: "2026-08-19T00:00:00.000Z",
    summary: "Refactor retry handling",
    operations: [
      {
        type: "replace",
        path: "packages/cli/src/relay-client.ts",
        baseSha256: hex,
        newSha256: hex,
        mediaType: "text/typescript",
        contentBase64: Buffer.from("export const retry = true;\n").toString("base64"),
      },
    ],
  };
}

describe("proposalSchema", () => {
  it("accepts deterministic whole-file operations", () => {
    expect(proposalSchema.parse(baseProposal()).operations[0]?.type).toBe("replace");
  });

  it("rejects traversal paths", () => {
    const input = baseProposal();
    input.operations[0]!.path = "../../outside";
    expect(() => proposalSchema.parse(input)).toThrow();
  });

  it("rejects empty proposals", () => {
    const input = baseProposal();
    input.operations = [];
    expect(() => proposalSchema.parse(input)).toThrow();
  });
});
