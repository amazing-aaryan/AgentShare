import { describe, expect, it } from "vitest";
import { parseClaudeCapture, parseClaudeSession } from "./index.js";

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

describe("Claude adapter", () => {
  it("extracts canonical user and assistant messages", () => {
    const result = parseClaudeSession(input, "synthetic-id");
    expect(result.sourceAgent).toBe("claude");
    expect(result.events.map((event) => event.text)).toEqual([
      "Question",
      "Answer",
    ]);
  });

  it("captures the session workspace root for v2 without changing v1 output", () => {
    const capture = parseClaudeCapture(input, "synthetic-id");
    expect(capture.workspaceRoot).toBe("C:/synthetic/repo");
    expect(capture.conversation.map((event) => event.text)).toEqual([
      "Question",
      "Answer",
    ]);
    expect(parseClaudeSession(input, "synthetic-id").resources).toEqual([]);
  });
});
