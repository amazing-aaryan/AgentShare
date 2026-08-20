import { describe, expect, it } from "vitest";
import { handleMcpRequest, type McpRuntime } from "./internal-mcp.js";

describe("AgentShare internal MCP", () => {
  const runtime: McpRuntime = {
    canPropose: true,
    environmentInfo: () =>
      Promise.resolve({ title: "Demo", revisionId: "rev_123" }),
    listFiles: () => Promise.resolve(["src/index.ts"]),
    search: () =>
      Promise.resolve([
        {
          source: "src/index.ts",
          quote: "answer = 42",
          startLine: 1,
          endLine: 1,
        },
      ]),
    readFile: () => Promise.resolve("export const answer = 42;\n"),
    readConversation: () =>
      Promise.resolve([{ sequence: 0, role: "user", text: "Why?" }]),
    stageReplace: (path, content) =>
      Promise.resolve(`staged replace ${path} ${content.length}`),
    stageCreate: (path, content) =>
      Promise.resolve(`staged create ${path} ${content.length}`),
    stageDelete: (path) => Promise.resolve(`staged delete ${path}`),
    proposalDiff: () => Promise.resolve("M src/index.ts"),
    proposalSubmit: (summary) =>
      Promise.resolve({ proposalId: "prop_123", summary }),
  };

  it("advertises only controlled environment and proposal tools", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      runtime,
    );
    const names = (
      response?.result as { tools: Array<{ name: string }> }
    ).tools.map((tool) => tool.name);
    expect(names).toContain("search");
    expect(names).toContain("read_file");
    expect(names).toContain("proposal_submit");
    expect(names).not.toContain("shell");
    expect(names).not.toContain("network");
  });

  it("dispatches tool calls through the controlled runtime", async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "read_file", arguments: { path: "src/index.ts" } },
      },
      runtime,
    );
    expect(JSON.stringify(response)).toContain("export const answer = 42");
  });

  it("does not advertise proposal tools for read-only environments", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { ...runtime, canPropose: false },
    );
    const names = (
      response?.result as { tools: Array<{ name: string }> }
    ).tools.map((tool) => tool.name);
    expect(names.some((name) => name.startsWith("proposal_"))).toBe(false);
  });
});
