import { describe, expect, it } from "vitest";
import { queryCreateRequestSchema, queryMessageSchema } from "./index.js";

describe("query protocol contracts", () => {
  it("accepts bounded query messages", () => {
    expect(
      queryMessageSchema.parse({
        id: "request-12345678901234567890",
        kind: "question",
        question: "What did your agent do?",
        createdAt: "2026-08-15T12:00:00.000Z",
      }).kind,
    ).toBe("question");
  });

  it("accepts bounded query answers", () => {
    expect(
      queryMessageSchema.parse({
        id: "response-12345678901234567890",
        kind: "answer",
        answer: "The deployment passed.",
        evidence: [{ source: "ci", detail: "Six jobs passed" }],
        createdAt: "2026-08-15T12:01:00.000Z",
      }).kind,
    ).toBe("answer");
  });

  it.each([
    { kind: "question", message: "Question text required" },
    { kind: "answer", message: "Answer text required" },
  ])("rejects $kind messages without required text", ({ kind, message }) => {
    expect(() =>
      queryMessageSchema.parse({
        id: "message-12345678901234567890",
        kind,
        createdAt: "2026-08-15T12:02:00.000Z",
      }),
    ).toThrow(message);
  });

  it("rejects missing endpoint capabilities", () => {
    expect(() => queryCreateRequestSchema.parse({})).toThrow();
  });
});
