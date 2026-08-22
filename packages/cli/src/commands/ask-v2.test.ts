import { describe, expect, it } from "vitest";
import { buildEnvironmentEvidencePrompt } from "./ask-v2.js";

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
});
