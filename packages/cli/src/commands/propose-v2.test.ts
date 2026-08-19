import { describe, expect, it } from "vitest";
import { buildProposalWorkerPrompt } from "./propose-v2.js";

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
});
