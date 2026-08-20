import { describe, expect, it } from "vitest";
import type { AcbManifest } from "@agentshare/contracts";
import { scanAndRedact } from "./index.js";

function manifest(text: string): AcbManifest {
  return {
    version: "acb-v1",
    title: "Synthetic credential fixture",
    sourceAgent: "generic",
    exportedAt: "2026-08-20T00:00:00.000Z",
    events: [
      {
        sequence: 0,
        role: "user",
        kind: "message",
        text,
        sourceId: "synthetic",
      },
    ],
    resources: [],
  };
}

describe("standalone credential families", () => {
  it.each([
    ["npm-token", `npm_${"a".repeat(36)}`],
    ["gitlab-token", `glpat-${"b".repeat(20)}`],
    ["slack-token", `xoxb-${"1".repeat(12)}-${"2".repeat(12)}-${"c".repeat(24)}`],
    ["stripe-secret-key", `sk_live_${"d".repeat(24)}`],
    ["google-api-key", `AIza${"E".repeat(35)}`],
  ])("redacts %s", (kind, token) => {
    const result = scanAndRedact(manifest(`credential ${token}`));

    expect(result.findings).toContainEqual(expect.objectContaining({ kind }));
    expect(result.manifest.events[0]?.text).not.toContain(token);
  });

  it.each([
    "npm_short",
    "glpat-short",
    "xoxb-not-a-token",
    "sk_test_too-short",
    "AIza-short",
  ])("leaves benign near-miss %s untouched", (value) => {
    const result = scanAndRedact(manifest(value));

    expect(result.findings).toHaveLength(0);
    expect(result.manifest.events[0]?.text).toBe(value);
  });
});
