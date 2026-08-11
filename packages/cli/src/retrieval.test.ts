import { describe, expect, it } from "vitest";
import type { AcbManifest } from "@agentshare/contracts";
import { evidencePrompt, retrieveEvidence } from "./retrieval.js";

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
    ]);

    expect(prompt).toContain("question-11");
    expect(prompt).toContain("answer-11");
    expect(prompt).not.toContain("question-0");
    expect(prompt).toContain("follow-up");
    expect(prompt).toContain("[session#event-0]");
  });

  it("ranks matching evidence, applies limits, and supports empty queries", () => {
    const manifest: AcbManifest = {
      version: "acb-v1",
      title: "Retrieval",
      sourceAgent: "generic",
      exportedAt: "2026-08-08T12:00:00.000Z",
      events: [
        {
          sequence: 0,
          role: "user",
          kind: "message",
          text: "alpha beta",
          sourceId: "session",
        },
        {
          sequence: 1,
          role: "assistant",
          kind: "message",
          text: "alpha alpha gamma",
          sourceId: "session",
        },
      ],
      resources: [],
    };

    expect(retrieveEvidence(manifest, "alpha", 1)).toEqual([
      expect.objectContaining({ citation: "session#event-1", score: 2 }),
    ]);
    expect(retrieveEvidence(manifest, "")).toHaveLength(2);
    expect(retrieveEvidence(manifest, "missing")).toEqual([]);
  });

  it("drops an oversized prior turn instead of overflowing the prompt", () => {
    const prompt = evidencePrompt(
      "next",
      [],
      [{ user: "x".repeat(32_001), assistant: "answer" }],
    );

    expect(prompt).toContain("No prior turns.");
    expect(prompt).not.toContain("x".repeat(100));
  });
});
