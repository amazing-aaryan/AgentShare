import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AcbManifest } from "@agentshare/contracts";
import { reviewInventory, reviewPayload, scanAndRedact } from "./index.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

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
          sha256: sha256(resource),
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
    ["inline code", (url: string) => `\`${url}\``],
    ["bold emphasis", (url: string) => `**${url}**`],
    ["mixed Markdown", (url: string) => `***\`${url}\`***`],
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

  it.each([
    ["malformed Base64", { contentBase64: "%%%" }],
    ["wrong byte length", { byteLength: 999 }],
    ["wrong SHA-256", { sha256: "f".repeat(64) }],
  ])(
    "rejects original text-resource integrity failure: %s",
    (_name, override) => {
      const content = Buffer.from("verified resource", "utf8");
      const input: AcbManifest = {
        version: "acb-v1",
        title: "Synthetic",
        sourceAgent: "generic",
        exportedAt: "2026-08-08T12:00:00.000Z",
        events: [],
        resources: [
          {
            id: "resource-1",
            mediaType: "text/plain",
            byteLength: content.byteLength,
            sha256:
              "a15886b7b2516c46b49eb97c66581f80df5633aa5269763980ce621b5e884b18",
            contentBase64: content.toString("base64"),
            ...override,
          },
        ],
      };

      expect(() => scanAndRedact(input)).toThrow();
    },
  );

  it("reviews text and binary resources without exposing binary Base64", () => {
    const text = Buffer.from("inspectable text", "utf8");
    const binary = Buffer.from([0, 1, 2]);
    const input: AcbManifest = {
      version: "acb-v1",
      title: "Synthetic",
      sourceAgent: "generic",
      exportedAt: "2026-08-08T12:00:00.000Z",
      events: [
        {
          sequence: 0,
          role: "assistant",
          kind: "message",
          text: "x".repeat(200),
          sourceId: "event-1",
        },
      ],
      resources: [
        {
          id: "text",
          mediaType: "text/plain",
          byteLength: text.byteLength,
          sha256: sha256(text),
          contentBase64: text.toString("base64"),
          sourcePath: "notes.txt",
        },
        {
          id: "binary",
          mediaType: "application/octet-stream",
          byteLength: binary.byteLength,
          sha256: sha256(binary),
          contentBase64: binary.toString("base64"),
        },
      ],
    };

    const scanned = scanAndRedact(input).manifest;
    const inventory = reviewInventory(scanned).join("\n");
    const payload = reviewPayload(scanned);

    expect(inventory).toContain("resource[binary] application/octet-stream");
    expect(inventory).toContain("...");
    expect(payload).toContain("inspectable text");
    expect(payload).toContain(
      "<3 bytes; base64 omitted from terminal display>",
    );
    expect(payload).not.toContain(binary.toString("base64"));
  });

  it("rejects secrets hidden behind a binary media type", () => {
    const capability = `https://relay.example/s/${"s".repeat(24)}#r=${"r".repeat(43)}&k=${"k".repeat(43)}`;
    const binary = Buffer.from(`\x89PNG\r\n${capability}`, "latin1");
    const input: AcbManifest = {
      version: "acb-v1",
      title: "Synthetic",
      sourceAgent: "generic",
      exportedAt: "2026-08-08T12:00:00.000Z",
      events: [],
      resources: [
        {
          id: "laundered",
          mediaType: "image/png",
          byteLength: binary.byteLength,
          sha256: sha256(binary),
          contentBase64: binary.toString("base64"),
        },
      ],
    };

    expect(() => scanAndRedact(input)).toThrow(/binary resource.*secret/iu);
  });

  it.each(["utf16le", "utf16be"] as const)(
    "rejects %s secrets hidden behind a binary media type",
    (encoding) => {
      const secret = Buffer.from(`password=${"s".repeat(20)}`, "utf16le");
      if (encoding === "utf16be") secret.swap16();
      const input: AcbManifest = {
        version: "acb-v1",
        title: "Synthetic",
        sourceAgent: "generic",
        exportedAt: "2026-08-08T12:00:00.000Z",
        events: [],
        resources: [
          {
            id: `encoded-${encoding}`,
            mediaType: "application/octet-stream",
            byteLength: secret.byteLength,
            sha256: sha256(secret),
            contentBase64: secret.toString("base64"),
          },
        ],
      };

      expect(() => scanAndRedact(input)).toThrow(/binary resource.*secret/iu);
    },
  );

  it("rejects a misaligned UTF-16 secret padded to evade encoding detection", () => {
    const secret = Buffer.from(`password=${"p".repeat(20)}`, "utf16le");
    const binary = Buffer.concat([Buffer.alloc(101, 0x41), secret]);
    const input: AcbManifest = {
      version: "acb-v1",
      title: "Synthetic",
      sourceAgent: "generic",
      exportedAt: "2026-08-08T12:00:00.000Z",
      events: [],
      resources: [
        {
          id: "padded-encoded-secret",
          mediaType: "application/octet-stream",
          byteLength: binary.byteLength,
          sha256: sha256(binary),
          contentBase64: binary.toString("base64"),
        },
      ],
    };

    expect(() => scanAndRedact(input)).toThrow(/binary resource.*secret/iu);
  });
});
