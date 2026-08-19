import { describe, expect, it } from "vitest";
import { parseCodexCapture, parseCodexSession } from "./index.js";

const input = [
  JSON.stringify({
    type: "session_meta",
    payload: { cwd: "C:/synthetic/repo" },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Question" }],
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Answer" }],
    },
  }),
].join("\n");

describe("Codex adapter", () => {
  it("extracts canonical user and assistant messages", () => {
    const result = parseCodexSession(input, "synthetic-id");
    expect(result.sourceAgent).toBe("codex");
    expect(result.events.map((event) => event.text)).toEqual([
      "Question",
      "Answer",
    ]);
  });

  it("captures the session workspace root for v2 without changing v1 output", () => {
    const capture = parseCodexCapture(input, "synthetic-id");
    expect(capture.workspaceRoot).toBe("C:/synthetic/repo");
    expect(capture.conversation.map((event) => event.text)).toEqual([
      "Question",
      "Answer",
    ]);
    expect(parseCodexSession(input, "synthetic-id").resources).toEqual([]);
  });
});
