import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasRequiredCompletion,
  readMcpCompletions,
  recordMcpCompletion,
  recordMcpFailure,
  type ReceiptChannel,
} from "./completion.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function channel(
  mode: "ask" | "propose" = "ask",
): Promise<ReceiptChannel> {
  const root = await mkdtemp(join(tmpdir(), "agentshare-receipt-test-"));
  roots.push(root);
  return {
    path: join(root, "receipt.jsonl"),
    environmentId: "env_test",
    runId: "unique-run",
    mode,
  };
}

describe("trusted completion channel", () => {
  it("does not hide an unresolved tool failure behind another successful read", async () => {
    const ch = await channel();
    await recordMcpCompletion(
      { ...ch, revisionId: "rev_fixture" },
      "read_file",
      "shared evidence",
    );
    await recordMcpFailure(ch, "read_conversation");
    const receipts = await readMcpCompletions(ch);
    expect(receipts[0]?.revisionId).toBe("rev_fixture");
    expect(hasRequiredCompletion(receipts, "ask", "env_test")).toBe(false);
  });
  it("records metadata only and requires nonempty reads", async () => {
    const ch = await channel();
    expect(await readMcpCompletions(ch)).toEqual([]);
    await recordMcpCompletion(ch, "search", [{ quote: "SECRET" }]);
    await recordMcpCompletion(ch, "read_conversation", []);
    await recordMcpCompletion(ch, "read_file", "  ");
    expect(
      hasRequiredCompletion(await readMcpCompletions(ch), "ask", "env_test"),
    ).toBe(false);
    await recordMcpCompletion(ch, "read_file", "SECRET shared text");
    expect(
      hasRequiredCompletion(await readMcpCompletions(ch), "ask", "env_test"),
    ).toBe(true);
    expect(await readFile(ch.path, "utf8")).not.toContain("SECRET");
    await expect(
      recordMcpCompletion(ch, "proposal_submit", { proposalId: "prop_test" }),
    ).rejects.toThrow("allowlist");
  });

  it("requires a returned proposal ID, excludes summary, and recognizes conversation evidence", async () => {
    const ch = await channel("propose");
    await expect(
      recordMcpCompletion(ch, "proposal_submit", "Submitted!"),
    ).rejects.toThrow("receipt ID");
    await recordMcpCompletion(ch, "proposal_submit", {
      proposalId: "prop_test",
      summary: "SECRET",
    });
    expect(
      hasRequiredCompletion(
        await readMcpCompletions(ch),
        "propose",
        "env_test",
      ),
    ).toBe(true);
    expect(await readFile(ch.path, "utf8")).not.toContain("SECRET");
    const ask = await channel();
    await recordMcpCompletion(ask, "read_conversation", [
      { text: "shared evidence" },
    ]);
    expect(
      hasRequiredCompletion(await readMcpCompletions(ask), "ask", "env_test"),
    ).toBe(true);
  });

  it("rejects replay, malformed records and oversized channels", async () => {
    const ch = await channel();
    await recordMcpCompletion(ch, "read_file", "read");
    await expect(
      readMcpCompletions({ ...ch, runId: "different-run" }),
    ).rejects.toThrow("Invalid MCP");
    await expect(
      readMcpCompletions({ ...ch, environmentId: "other" }),
    ).rejects.toThrow("Invalid MCP");
    await expect(
      readMcpCompletions({ ...ch, mode: "propose" }),
    ).rejects.toThrow("Invalid MCP");
    await writeFile(ch.path, "not json\n");
    await expect(readMcpCompletions(ch)).rejects.toThrow();
    await writeFile(ch.path, "x".repeat(262_145));
    await expect(readMcpCompletions(ch)).rejects.toThrow("limit");
  });
});
