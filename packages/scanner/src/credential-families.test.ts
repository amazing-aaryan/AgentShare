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

describe("credential families", () => {
  it("redacts valid read capabilities even with a malformed optional proposal token", () => {
    const url = `https://handoff.example/e/env_${"e".repeat(24)}#r=${"r".repeat(43)}&k=${"k".repeat(43)}&p=short`;
    const result = scanAndRedact(manifest(`(${url})`));
    expect(result.manifest.events[0]?.text).toBe(
      "([REDACTED:agentshare-capability-url])",
    );
  });

  it.each([
    "api_key",
    "token",
    "secret",
    "password",
    "CLOUDFLARE_API_TOKEN",
    "CF_API_TOKEN",
  ])("redacts quoted JSON key %s without breaking JSON", (key) => {
    const value = "s".repeat(40);
    const result = scanAndRedact(manifest(JSON.stringify({ [key]: value })));
    const parsed = JSON.parse(result.manifest.events[0]?.text ?? "") as Record<
      string,
      string
    >;
    expect(parsed[key]).toMatch(/^\[REDACTED:/u);
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it.each(["", ".", ")", "`"])(
    "redacts v2 environment URLs with trailing %s",
    (trailing) => {
      const url = `https://handoff.example/e/env_${"e".repeat(24)}?relay=https%3A%2F%2Frelay.example#r=${"r".repeat(43)}&k=${"k".repeat(43)}&p=${"p".repeat(43)}`;
      const result = scanAndRedact(manifest(url + trailing));
      expect(result.manifest.events[0]?.text).toBe(
        `[REDACTED:agentshare-capability-url]${trailing}`,
      );
      expect(JSON.stringify(result)).not.toContain("p".repeat(43));
    },
  );

  it.each([
    ["npm-token", `npm_${"a".repeat(36)}`],
    ["gitlab-token", `glpat-${"b".repeat(20)}`],
    [
      "slack-token",
      `xoxb-${"1".repeat(12)}-${"2".repeat(12)}-${"c".repeat(24)}`,
    ],
    ["stripe-secret-key", `sk_live_${"d".repeat(24)}`],
    ["google-api-key", `AIza${"E".repeat(35)}`],
    ["cloudflare-api-token", `CLOUDFLARE_API_TOKEN=${"f".repeat(40)}`],
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
    "CLOUDFLARE_API_TOKEN=short",
  ])("leaves benign near-miss %s untouched", (value) => {
    const result = scanAndRedact(manifest(value));

    expect(result.findings).toHaveLength(0);
    expect(result.manifest.events[0]?.text).toBe(value);
  });
});
