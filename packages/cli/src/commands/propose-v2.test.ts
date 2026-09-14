import { describe, expect, it, vi } from "vitest";
import {
  buildProposalWorkerPrompt,
  proposeAttachedEnvironmentChange,
} from "./propose-v2.js";

vi.mock("../environment/refresh.js", () => ({
  refreshAttachedEnvironment: vi.fn(),
}));
vi.mock("../environment/state.js", () => ({
  findAttachedEnvironment: vi
    .fn()
    .mockResolvedValue({ proposalCapability: "cap" }),
}));

describe("proposal worker prompt", () => {
  it("requires staging, review, and submission without host writes", () => {
    const prompt = buildProposalWorkerPrompt("Refactor retry handling");
    expect(prompt).toContain("AgentShare MCP tools only");
    expect(prompt).toContain("proposal_stage");
    expect(prompt).toContain("proposal_diff");
    expect(prompt).toContain("proposal_submit");
    expect(prompt).toContain("never writes UserA's workspace");
    expect(prompt).toContain("Refactor retry handling");
  });

  it("requires a trusted successful submission, not proposal prose or staging", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, output: "Submitted prop_fake" });
    await expect(
      proposeAttachedEnvironmentChange("env_test", "Change it", {
        target: "codex",
        runner,
      }),
    ).rejects.toThrow("no completed proposal");
    expect(runner.mock.calls[0]?.[3]).toMatchObject({ mode: "propose" });
    const receipt = {
      version: 1,
      runId: "test",
      environmentId: "env_test",
      mode: "propose",
      status: "completed",
      tool: "proposal_stage_replace",
      evidenceItems: 0,
    };
    runner.mockResolvedValue({
      exitCode: 0,
      output: "staged",
      receipts: [receipt],
    });
    await expect(
      proposeAttachedEnvironmentChange("env_test", "Change it", {
        target: "codex",
        runner,
      }),
    ).rejects.toThrow("no completed proposal");
    runner.mockResolvedValue({
      exitCode: 0,
      output: "Submitted",
      receipts: [
        { ...receipt, tool: "proposal_submit", proposalId: "prop_test" },
      ],
    });
    await expect(
      proposeAttachedEnvironmentChange("env_test", "Change it", {
        target: "codex",
        runner,
      }),
    ).resolves.toBe("Submitted");
    runner.mockResolvedValue({
      exitCode: 1,
      output: "Submitted",
      receipts: [
        { ...receipt, tool: "proposal_submit", proposalId: "prop_test" },
      ],
    });
    await expect(
      proposeAttachedEnvironmentChange("env_test", "Change it", {
        target: "codex",
        runner,
      }),
    ).rejects.toThrow("code 1");
  });
});
