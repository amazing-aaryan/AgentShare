import { describe, expect, it } from "vitest";
import { parseClaudeSession } from "./index.js";

describe("Claude adapter", () => {
  it("extracts canonical user and assistant messages", () => {
    const input = [
      JSON.stringify({
        type: "user",
        cwd: "C:/synthetic/repo",
        message: { content: "Question" },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Answer" }, { type: "tool_use" }],
        },
      }),
    ].join("\n");
    const result = parseClaudeSession(input, "synthetic-id");
    expect(result.sourceAgent).toBe("claude");
    expect(result.events.map((event) => event.text)).toEqual([
      "Question",
      "Answer",
    ]);
  });
});
