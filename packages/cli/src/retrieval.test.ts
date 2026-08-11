import { describe, expect, it } from "vitest";
import { evidencePrompt } from "./retrieval.js";

describe("recipient conversation continuity", () => {
  it("includes bounded recent user and assistant turns in the next prompt", () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      user: `question-${index}`,
      assistant: `answer-${index}`,
    }));
    const prompt = Reflect.apply(evidencePrompt, undefined, [
      "follow-up",
      [{ citation: "session#event-0", text: "evidence", score: 1 }],
      history,
    ]) as string;

    expect(prompt).toContain("question-11");
    expect(prompt).toContain("answer-11");
    expect(prompt).not.toContain("question-0");
    expect(prompt).toContain("follow-up");
    expect(prompt).toContain("[session#event-0]");
  });
});
