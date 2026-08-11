import { describe, expect, it } from "vitest";
import type { AcbManifest, AuthoritativeMetadata } from "@agentshare/contracts";
import {
  buildShareUrl,
  decodeAcb,
  decryptBundle,
  encodeAcb,
  encryptBundle,
  keyFromFragment,
  keyToFragment,
  logicalFingerprint,
  parseShareUrl,
} from "./index.js";

const manifest: AcbManifest = {
  version: "acb-v1",
  title: "Synthetic session",
  sourceAgent: "codex",
  exportedAt: "2026-08-08T12:00:00.000Z",
  events: [
    {
      sequence: 0,
      role: "user",
      kind: "message",
      text: "Explain the parser",
      sourceId: "turn-1",
    },
  ],
  resources: [],
};

const metadata: AuthoritativeMetadata = {
  protocolVersion: "agentshare-relay-v1",
  shareId: "abcdefghijklmnopqrstuvwx",
  createdAt: "2026-08-08T12:00:00.000Z",
  expiresAt: "2026-08-08T13:00:00.000Z",
  limits: { maxCiphertextBytes: 50 * 1024 * 1024, maxTtlSeconds: 72 * 60 * 60 },
};

describe("ACB", () => {
  it("round trips canonical bytes", () => {
    expect(decodeAcb(encodeAcb(manifest))).toEqual(manifest);
  });

  it("keeps logical fingerprint stable across export time", () => {
    expect(logicalFingerprint(manifest)).toBe(
      logicalFingerprint({
        ...manifest,
        exportedAt: "2026-08-08T12:01:00.000Z",
      }),
    );
  });

  it("encrypts and authenticates metadata", () => {
    const plaintext = encodeAcb(manifest);
    const encrypted = encryptBundle(plaintext, metadata);
    expect(
      decodeAcb(decryptBundle(encrypted.envelope, metadata, encrypted.key)),
    ).toEqual(manifest);
    expect(() =>
      decryptBundle(
        encrypted.envelope,
        { ...metadata, expiresAt: "2026-08-08T14:00:00.000Z" },
        encrypted.key,
      ),
    ).toThrow();
  });

  it("round trips fragment key without sending it in safe URL", () => {
    const encrypted = encryptBundle(encodeAcb(manifest), metadata);
    const link = buildShareUrl({
      origin: "https://share.example",
      shareId: metadata.shareId,
      readCapability: "reader-secret",
      fragmentKey: keyToFragment(encrypted.key),
    });
    const parsed = parseShareUrl(link);
    expect(keyFromFragment(parsed.fragmentKey)).toEqual(encrypted.key);
    expect(new URL(link).search).toBe("");
    expect(parsed.safeUrl).not.toContain("#");
    expect(parsed.safeUrl).not.toContain(parsed.fragmentKey);
    expect(parsed.safeUrl).not.toContain(parsed.readCapability);
  });

  it.each([
    ["malformed Base64", { contentBase64: "%%%" }],
    ["wrong byte length", { byteLength: 999 }],
    ["wrong SHA-256", { sha256: "f".repeat(64) }],
  ])("rejects resource content with %s", (_name, override) => {
    const content = Buffer.from("verified resource", "utf8");
    const invalid = {
      ...manifest,
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

    expect(() =>
      decodeAcb(Buffer.from(JSON.stringify(invalid), "utf8")),
    ).toThrow();
  });
});
