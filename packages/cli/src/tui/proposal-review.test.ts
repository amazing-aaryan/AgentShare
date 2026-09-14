import { describe, expect, it } from "vitest";
import { renderProposalDiff } from "./proposal-review.js";

describe("proposal review", () => {
  it("renders replacement, creation, and deletion without applying them", () => {
    const text = renderProposalDiff(
      {
        version: "agentshare-proposal-v1",
        proposalId: "prop_12345678901234567890",
        environmentId: "env_12345678901234567890",
        baseRevisionId: "rev_12345678901234567890",
        createdAt: "2026-08-19T00:00:00.000Z",
        summary: "Update files",
        operations: [
          {
            type: "replace",
            path: "a.txt",
            baseSha256: "a".repeat(64),
            newSha256: "b".repeat(64),
            mediaType: "text/plain",
            contentBase64: Buffer.from("new\n").toString("base64"),
          },
          {
            type: "create",
            path: "b.txt",
            newSha256: "c".repeat(64),
            mediaType: "text/plain",
            contentBase64: Buffer.from("created\n").toString("base64"),
          },
          {
            type: "delete",
            path: "c.txt",
            baseSha256: "d".repeat(64),
          },
        ],
      },
      new Map([
        ["a.txt", "old\n"],
        ["c.txt", "gone\n"],
      ]),
    );
    expect(text).toContain("M a.txt");
    expect(text).toContain("- old");
    expect(text).toContain("+ new");
    expect(text).toContain("A b.txt");
    expect(text).toContain("+ created");
    expect(text).toContain("D c.txt");
    expect(text).toContain("- gone");
  });
});
