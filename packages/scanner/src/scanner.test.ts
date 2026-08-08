import { describe, expect, it } from "vitest";
import type { AcbManifest } from "@agentshare/contracts";
import { scanAndRedact } from "./index.js";

describe("final payload scanner", () => {
  it("redacts event and text-resource secrets", () => {
    const secret = `sk-${"a".repeat(24)}`;
    const resource = Buffer.from(`token=${"b".repeat(20)}`, "utf8");
    const input: AcbManifest = {
      version: "acb-v1",
      title: "Synthetic",
      sourceAgent: "generic",
      exportedAt: "2026-08-08T12:00:00.000Z",
      events: [
        {
          sequence: 0,
          role: "user",
          kind: "message",
          text: secret,
          sourceId: "one",
        },
      ],
      resources: [
        {
          id: "resource-1",
          mediaType: "text/plain",
          byteLength: resource.byteLength,
          sha256: "a".repeat(64),
          contentBase64: resource.toString("base64"),
        },
      ],
    };
    const result = scanAndRedact(input);
    expect(result.findings).toHaveLength(2);
    expect(result.manifest.events[0]?.text).not.toContain(secret);
    expect(
      Buffer.from(
        result.manifest.resources[0]?.contentBase64 ?? "",
        "base64",
      ).toString(),
    ).toContain("[REDACTED:generic-secret]");
  });
});
