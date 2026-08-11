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

  it("redacts AgentShare capability URLs and bearer tokens from every string field", () => {
    const capability = `https://relay.example/s/${"s".repeat(24)}?r=${"r".repeat(43)}#k=${"k".repeat(43)}`;
    const bearer = `Bearer eyJ${"a".repeat(30)}.${"b".repeat(30)}.${"c".repeat(30)}`;
    const input: AcbManifest = {
      version: "acb-v1",
      title: capability,
      sourceAgent: "generic",
      exportedAt: "2026-08-08T12:00:00.000Z",
      events: [
        {
          sequence: 0,
          role: "assistant",
          kind: "message",
          text: `Old handoff: ${capability}\nAuthorization: ${bearer}`,
          sourceId: capability,
        },
      ],
      resources: [],
    };

    const result = scanAndRedact(input);

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["agentshare-capability-url", "bearer-token"]),
    );
    expect(JSON.stringify(result.manifest)).not.toContain(capability);
    expect(JSON.stringify(result.manifest)).not.toContain(bearer);
  });

  it.each([
    ["parentheses", (url: string) => `(${url})`],
    ["brackets", (url: string) => `[${url}]`],
    ["trailing period", (url: string) => `${url}.`],
    ["trailing comma", (url: string) => `${url},`],
    ["trailing semicolon", (url: string) => `${url};`],
    ["trailing question mark", (url: string) => `${url}?`],
  ])("redacts capability URLs wrapped with %s", (_name, wrap) => {
    const capability = `https://relay.example/s/${"s".repeat(24)}#r=${"r".repeat(43)}&k=${"k".repeat(43)}`;
    const wrapped = wrap(capability);
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
          text: `Prior handoff: ${wrapped}`,
          sourceId: "wrapped-capability",
        },
      ],
      resources: [],
    };

    const result = scanAndRedact(input);
    const serialized = JSON.stringify(result.manifest);

    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "agentshare-capability-url" }),
    );
    expect(serialized).not.toContain("r".repeat(43));
    expect(serialized).not.toContain("k".repeat(43));
  });
});
