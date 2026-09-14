import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEnvironmentMcpRuntime,
  handleMcpRequest,
  type McpRuntime,
} from "./internal-mcp.js";
import { readAttachedManifest } from "../environment/accept.js";
import { findAttachedEnvironment } from "../environment/state.js";
import { submitProposalOperations } from "../proposals/submit.js";

vi.mock("../environment/accept.js", () => ({
  readAttachedManifest: vi.fn(),
  readAttachedFile: vi.fn(),
  searchAttachedEnvironment: vi.fn(),
}));
vi.mock("../environment/state.js", () => ({
  findAttachedEnvironment: vi.fn(),
}));
vi.mock("../environment/refresh.js", () => ({
  refreshAttachedEnvironment: vi.fn(),
}));
vi.mock("../proposals/submit.js", () => ({
  submitProposalOperations: vi.fn(),
}));

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

  it("advertises truthful side effect annotations", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      runtime,
    );
    const tools = (
      response?.result as {
        tools: Array<{ name: string; annotations: Record<string, boolean> }>;
      }
    ).tools;
    expect(
      tools.find((tool) => tool.name === "read_file")?.annotations,
    ).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(
      tools.find((tool) => tool.name === "proposal_stage_replace")?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(
      tools.find((tool) => tool.name === "proposal_submit")?.annotations,
    ).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("records completed calls, never rejected calls or failed receipts", async () => {
    const completed = vi.fn().mockResolvedValue(undefined);
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "read_file", arguments: { path: "a.txt" } },
    };
    await handleMcpRequest(request, runtime, completed);
    expect(completed).toHaveBeenCalledWith(
      "read_file",
      "export const answer = 42;\n",
    );
    completed.mockClear();
    await handleMcpRequest(
      request,
      { ...runtime, readFile: () => Promise.reject(new Error("denied")) },
      completed,
    );
    expect(completed).not.toHaveBeenCalled();
    await handleMcpRequest(
      {
        ...request,
        params: { name: "proposal_submit", arguments: { summary: "x" } },
      },
      { ...runtime, canPropose: false },
      completed,
    );
    expect(completed).not.toHaveBeenCalled();
    completed.mockRejectedValue(new Error("receipt unavailable"));
    expect(
      (await handleMcpRequest(request, runtime, completed))?.result,
    ).toMatchObject({ isError: true });
  });
});

describe("proposal staging revision pin", () => {
  const manifest = (
    revisionId: string,
  ): Awaited<ReturnType<typeof readAttachedManifest>> => ({
    version: "agentshare-environment-v2",
    environmentId: "env_test",
    title: "Fixture",
    sourceAgent: "codex",
    createdAt: "2026-08-27T00:00:00.000Z",
    revisionId,
    workspace: {
      rootName: "fixture",
      files: [
        {
          path: "a.txt",
          sha256: "a".repeat(64),
          mediaType: "text/plain",
          byteLength: 3,
          resourceId: "file_test",
          executable: false,
          blobs: [],
        },
      ],
    },
    conversation: { events: [] },
    proposalPolicy: { enabled: true, encryptionPublicKey: "a".repeat(43) },
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(findAttachedEnvironment).mockResolvedValue({
      proposalCapability: "cap",
    } as Awaited<ReturnType<typeof findAttachedEnvironment>>);
    vi.mocked(readAttachedManifest).mockResolvedValue(manifest("rev_old"));
    vi.mocked(submitProposalOperations).mockResolvedValue({
      proposalId: "prop_test",
      summary: "done",
    } as Awaited<ReturnType<typeof submitProposalOperations>>);
  });

  it("defaults to read-only even when attachment has proposal capability", async () => {
    const runtime = await createEnvironmentMcpRuntime("env_test");
    expect(runtime.canPropose).toBe(false);
    await expect(runtime.stageReplace("a.txt", "new")).rejects.toThrow(
      "read-only",
    );
    await expect(runtime.stageCreate("b.txt", "new")).rejects.toThrow(
      "read-only",
    );
    await expect(runtime.stageDelete("a.txt")).rejects.toThrow("read-only");
    await expect(runtime.proposalSubmit("summary")).rejects.toThrow(
      "read-only",
    );
  });

  it.each(["replace", "create", "delete"])(
    "pins %s base and rejects later revision changes without submission",
    async (operation) => {
      const runtime = await createEnvironmentMcpRuntime("env_test", {
        mode: "propose",
      });
      if (operation === "replace") await runtime.stageReplace("a.txt", "new");
      else if (operation === "create")
        await runtime.stageCreate("b.txt", "new");
      else await runtime.stageDelete("a.txt");
      vi.mocked(readAttachedManifest).mockResolvedValue(manifest("rev_new"));
      await expect(runtime.proposalSubmit("summary")).rejects.toThrow(
        "revision changed",
      );
      await expect(runtime.stageReplace("a.txt", "other")).rejects.toThrow(
        "revision changed",
      );
      await expect(runtime.proposalDiff()).rejects.toThrow("revision changed");
      expect(submitProposalOperations).not.toHaveBeenCalled();
    },
  );

  it("passes exact base to submit and clears it only after successful submission", async () => {
    const runtime = await createEnvironmentMcpRuntime("env_test", {
      mode: "propose",
    });
    await runtime.stageReplace("a.txt", "new");
    vi.mocked(submitProposalOperations).mockRejectedValueOnce(
      new Error("relay unavailable"),
    );
    await expect(runtime.proposalSubmit("summary")).rejects.toThrow(
      "relay unavailable",
    );
    expect(await runtime.proposalDiff()).toHaveLength(1);
    await runtime.proposalSubmit("summary");
    expect(submitProposalOperations).toHaveBeenLastCalledWith(
      "env_test",
      "summary",
      [
        expect.objectContaining({
          type: "replace",
          baseSha256: "a".repeat(64),
        }),
      ],
      { baseRevisionId: "rev_old" },
    );
    vi.mocked(readAttachedManifest).mockResolvedValue(manifest("rev_new"));
    await runtime.stageCreate("b.txt", "new");
    await runtime.proposalSubmit("next");
    expect(submitProposalOperations).toHaveBeenLastCalledWith(
      "env_test",
      "next",
      expect.any(Array),
      { baseRevisionId: "rev_new" },
    );
  });
});
