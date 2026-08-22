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
        contentBase64: Buffer.from("export const retry = true;\n").toString(
          "base64",
        ),
      },
    ],
  };
}

describe("proposalSchema", () => {
  it("accepts deterministic whole-file operations", () => {
    expect(proposalSchema.parse(baseProposal()).operations[0]?.type).toBe(
      "replace",
    );
  });

  it("accepts create and delete operations", () => {
    const input = baseProposal();
    input.operations = [
      {
        type: "create",
        path: "packages/new.ts",
        newSha256: hex,
        mediaType: "text/typescript",
        contentBase64: Buffer.from("export const value = 1;\n").toString(
          "base64",
        ),
      } as (typeof input.operations)[number],
      {
        type: "delete",
        path: "packages/old.ts",
        baseSha256: hex,
      } as (typeof input.operations)[number],
    ];
    expect(proposalSchema.parse(input).operations.map((op) => op.type)).toEqual([
      "create",
      "delete",
    ]);
  });

  it("rejects traversal paths", () => {
    const input = baseProposal();
    const operation = input.operations[0];
    if (operation === undefined) throw new Error("Missing proposal operation");
    operation.path = "../../outside";
    expect(() => proposalSchema.parse(input)).toThrow();
  });

  it("rejects duplicate operation paths", () => {
    const input = baseProposal();
    input.operations.push({ ...input.operations[0]! });
    expect(() => proposalSchema.parse(input)).toThrow();
  });

  it("rejects empty proposals", () => {
    const input = baseProposal();
    input.operations = [];
    expect(() => proposalSchema.parse(input)).toThrow();
  });
});
