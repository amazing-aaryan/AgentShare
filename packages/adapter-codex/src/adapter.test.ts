import { describe, expect, it } from "vitest";
import { parseCodexSession } from "./index.js";

describe("Codex adapter", () => {
  it("extracts canonical user and assistant messages", () => {
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
    const result = parseCodexSession(input, "synthetic-id");
    expect(result.sourceAgent).toBe("codex");
    expect(result.events.map((event) => event.text)).toEqual([
      "Question",
      "Answer",
    ]);
  });
});
