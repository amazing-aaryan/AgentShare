import { describe, expect, it, vi } from "vitest";
import {
  askAttachedEnvironment,
  buildEnvironmentEvidencePrompt,
} from "./ask-v2.js";
import type { McpCompletionReceipt } from "../worker/completion.js";

vi.mock("../environment/refresh.js", () => ({
  refreshAttachedEnvironment: vi.fn(),
}));
vi.mock("../environment/accept.js", () => ({
  searchAttachedEnvironment: vi.fn().mockResolvedValue([]),
}));

describe("environment Q&A prompt", () => {
  it("includes shared evidence citations and denies external assumptions", () => {
    const prompt = buildEnvironmentEvidencePrompt("Why?", [
      {
        source: "src/index.ts",
        kind: "file",
        quote: "export const answer = 42;",
        score: 2,
        startLine: 1,
        endLine: 1,
      },
      {
        source: "thread#event-3",
        kind: "conversation",
        quote: "We chose this for deterministic behavior.",
        score: 1,
        sequence: 3,
      },
    ]);
    expect(prompt).toContain("[src/index.ts:L1-L1]");
    expect(prompt).toContain("[thread#event-3]");
    expect(prompt).toContain("Answer only from the AgentShare evidence");
    expect(prompt).toContain("Why?");
  });

  it("rejects exit-zero prose and metadata/search-only receipts", async () => {
    const runner = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "I read the evidence and finished.",
    });
    await expect(
      askAttachedEnvironment("env_test", "Why?", { target: "codex", runner }),
    ).rejects.toThrow("no completed");
    expect(runner.mock.calls[0]?.[3]).toMatchObject({ mode: "ask" });
    for (const tool of [
      "environment_info",
      "list_files",
      "search",
      "read_file",
    ]) {
      runner.mockResolvedValue({
        exitCode: 0,
        output: "done",
        receipts: [
          {
            version: 1,
            runId: "test",
            environmentId: "env_test",
            mode: "ask",
            status: "completed",
            tool,
            evidenceItems: 0,
          },
        ],
      });
      await expect(
        askAttachedEnvironment("env_test", "Why?", { target: "codex", runner }),
      ).rejects.toThrow("no completed");
    }
  });

  it("accepts a completed read, rejects wrong environment/mode, nonzero exit and empty answer", async () => {
    const receipt: McpCompletionReceipt = {
      version: 1,
      runId: "test",
      environmentId: "env_test",
      mode: "ask",
      tool: "read_file",
      status: "completed",
      evidenceItems: 1,
    };
    const runner = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: "Answer [a.txt:L1]",
      receipts: [receipt],
    });
    await expect(
      askAttachedEnvironment("env_test", "Why?", { target: "codex", runner }),
    ).resolves.toContain("Answer");
    for (const changed of [{ environmentId: "other" }, { mode: "propose" }]) {
      runner.mockResolvedValue({
        exitCode: 0,
        output: "done",
        receipts: [{ ...receipt, ...changed }],
      });
      await expect(
        askAttachedEnvironment("env_test", "Why?", { target: "codex", runner }),
      ).rejects.toThrow("no completed");
    }
    runner.mockResolvedValue({
      exitCode: 2,
      output: "done",
      receipts: [receipt],
    });
    await expect(
      askAttachedEnvironment("env_test", "Why?", { target: "codex", runner }),
    ).rejects.toThrow("code 2");
    runner.mockResolvedValue({ exitCode: 0, output: " ", receipts: [receipt] });
    await expect(
      askAttachedEnvironment("env_test", "Why?", { target: "codex", runner }),
    ).rejects.toThrow("no answer");
  });
});
