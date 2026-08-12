import { createHash } from "node:crypto";
import {
  acbManifestSchema,
  type AcbManifest,
  type AuthoritativeMetadata,
} from "@agentshare/contracts";

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  return serialize(toJsonValue(value));
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Non-finite number in canonical JSON");
    return value;
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b, "en"),
    )) {
      if (child !== undefined) result[key] = toJsonValue(child);
    }
    return result;
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

function serialize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.entries(value)
    .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child)}`)
    .join(",")}}`;
}

export function encodeAcb(manifest: AcbManifest): Uint8Array {
  const parsed = acbManifestSchema.parse(manifest);
  assertResourceIntegrity(parsed);
  return Buffer.from(canonicalJson(parsed), "utf8");
}

export function decodeAcb(bytes: Uint8Array): AcbManifest {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const manifest = acbManifestSchema.parse(value);
  assertResourceIntegrity(manifest);
  return manifest;
}

export function logicalFingerprint(manifest: AcbManifest): string {
  const parsed = acbManifestSchema.parse(manifest);
  const logical = {
    version: parsed.version,
    title: parsed.title,
    sourceAgent: parsed.sourceAgent,
    events: parsed.events,
    resources: parsed.resources.map((resource) => ({
      id: resource.id,
      mediaType: resource.mediaType,
      byteLength: resource.byteLength,
      sha256: resource.sha256,
      ...(resource.sourcePath === undefined
        ? {}
        : { sourcePath: resource.sourcePath }),
    })),
  };
  return sha256Hex(Buffer.from(canonicalJson(logical), "utf8"));
}

export function canonicalAad(metadata: AuthoritativeMetadata): Uint8Array {
  return Buffer.from(canonicalJson(metadata), "utf8");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    const isAlphabet =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f;
    if (!isAlphabet) return false;
  }
  return true;
}

export function assertResourceIntegrity(manifest: AcbManifest): void {
  for (const resource of manifest.resources) {
    if (!isCanonicalBase64(resource.contentBase64)) {
      throw new Error(`Resource ${resource.id} has invalid Base64 content`);
    }
    const content = Buffer.from(resource.contentBase64, "base64");
    if (content.byteLength !== resource.byteLength) {
      throw new Error(`Resource ${resource.id} byte length mismatch`);
    }
    if (sha256Hex(content) !== resource.sha256) {
      throw new Error(`Resource ${resource.id} SHA-256 mismatch`);
    }
  }
}
