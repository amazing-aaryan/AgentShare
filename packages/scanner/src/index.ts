import { createHash } from "node:crypto";
import { assertResourceIntegrity } from "@agentshare/acb";
import { acbManifestSchema, type AcbManifest } from "@agentshare/contracts";

export type SecretFinding = {
  kind: string;
  location: string;
  redactedPreview: string;
};

export type ScanResult = {
  manifest: AcbManifest;
  findings: SecretFinding[];
};

const PATTERNS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  {
    kind: "private-key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  },
  {
    kind: "openai-api-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    kind: "anthropic-api-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    kind: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/gu,
  },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
  { kind: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/gu },
  {
    kind: "gitlab-token",
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    kind: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu,
  },
  {
    kind: "stripe-secret-key",
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/gu,
  },
  {
    kind: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/gu,
  },
  {
    kind: "cloudflare-api-token",
    pattern:
      /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}["']?/gu,
  },
  {
    kind: "generic-secret",
    pattern:
      /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}["']?/giu,
  },
  {
    kind: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,}){0,2}\b/giu,
  },
];

const HTTP_URL = /https?:\/\/[^\s<>"']+/giu;
const CAPABILITY_TOKEN_CHARACTER = /^[A-Za-z0-9_-]$/u;

export function scanAndRedact(input: AcbManifest): ScanResult {
  const manifest = structuredClone(acbManifestSchema.parse(input));
  assertResourceIntegrity(manifest);
  const findings: SecretFinding[] = [];

  manifest.title = redact(manifest.title, "title", findings);
  manifest.events = manifest.events.map((event) => ({
    ...event,
    text: redact(event.text, `events[${event.sequence}].text`, findings),
    sourceId: redact(
      event.sourceId,
      `events[${event.sequence}].sourceId`,
      findings,
    ),
  }));
  manifest.resources = manifest.resources.map((resource, index) => {
    const scannedMetadata = {
      ...resource,
      id: redact(resource.id, `resources[${index}].id`, findings),
      ...(resource.sourcePath === undefined
        ? {}
        : {
            sourcePath: redact(
              resource.sourcePath,
              `resources[${index}].sourcePath`,
              findings,
            ),
          }),
    };
    if (
      !resource.mediaType.startsWith("text/") &&
      resource.mediaType !== "application/json"
    ) {
      const bytes = Buffer.from(resource.contentBase64, "base64");
      for (const view of binaryTextViews(bytes)) {
        const binaryFindings: SecretFinding[] = [];
        redact(view, `resources[${index}].content`, binaryFindings);
        if (binaryFindings.length > 0) {
          throw new Error(
            `Binary resource ${resource.id} contains a suspected secret and cannot be shared`,
          );
        }
      }
      return scannedMetadata;
    }
    const original = Buffer.from(resource.contentBase64, "base64").toString(
      "utf8",
    );
    const redacted = redact(original, `resources[${index}].content`, findings);
    const bytes = Buffer.from(redacted, "utf8");
    return {
      ...scannedMetadata,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentBase64: bytes.toString("base64"),
    };
  });

  return { manifest, findings };
}

function* binaryTextViews(bytes: Buffer): Generator<string> {
  yield bytes.toString("latin1");
  yield bytes.toString("utf8");
  for (const offset of [0, 1]) {
    const byteLength = (bytes.byteLength - offset) & ~1;
    if (byteLength < 2) continue;
    const aligned = bytes.subarray(offset, offset + byteLength);
    yield aligned.toString("utf16le");
    const bigEndian = Buffer.from(aligned);
    bigEndian.swap16();
    yield bigEndian.toString("utf16le");
  }
}

function redact(
  text: string,
  location: string,
  findings: SecretFinding[],
): string {
  let result = text.replace(HTTP_URL, (candidate) => {
    const capability = capabilityUrlWithTrailingText(candidate);
    if (capability === undefined) return candidate;
    findings.push({
      kind: "agentshare-capability-url",
      location,
      redactedPreview: "https://...[REDACTED]",
    });
    return `[REDACTED:agentshare-capability-url]${capability.trailing}`;
  });
  for (const { kind, pattern } of PATTERNS) {
    result = result.replace(pattern, (match) => {
      findings.push({
        kind,
        location,
        redactedPreview: `${match.slice(0, 4)}...[REDACTED]`,
      });
      return `[REDACTED:${kind}]`;
    });
  }
  return result;
}

function capabilityUrlWithTrailingText(
  candidate: string,
): { trailing: string } | undefined {
  let end = candidate.length;
  while (end > 0) {
    if (isAgentShareCapabilityUrl(candidate.slice(0, end))) {
      return { trailing: candidate.slice(end) };
    }
    const last = candidate[end - 1];
    if (last === undefined || CAPABILITY_TOKEN_CHARACTER.test(last)) return;
    end -= 1;
  }
  return undefined;
}

function isAgentShareCapabilityUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    const fragment = new URLSearchParams(url.hash.slice(1));
    return (
      /^\/s\/[A-Za-z0-9_-]{20,100}$/u.test(url.pathname) &&
      /^[A-Za-z0-9_-]{20,}$/u.test(
        fragment.get("r") ?? url.searchParams.get("r") ?? "",
      ) &&
      /^[A-Za-z0-9_-]{40,}$/u.test(fragment.get("k") ?? "")
    );
  } catch {
    return false;
  }
}

export function reviewInventory(manifest: AcbManifest): string[] {
  return [
    `title: ${manifest.title}`,
    `sourceAgent: ${manifest.sourceAgent}`,
    `events: ${manifest.events.length}`,
    ...manifest.events.map(
      (event) =>
        `event[${event.sequence}] ${event.role}/${event.kind}: ${preview(event.text)}`,
    ),
    `resources: ${manifest.resources.length}`,
    ...manifest.resources.map(
      (resource) =>
        `resource[${resource.id}] ${resource.mediaType} ${resource.byteLength} bytes sha256=${resource.sha256}`,
    ),
  ];
}

export function reviewPayload(manifest: AcbManifest): string {
  const inspectable = {
    ...manifest,
    resources: manifest.resources.map((resource) => ({
      id: resource.id,
      mediaType: resource.mediaType,
      byteLength: resource.byteLength,
      sha256: resource.sha256,
      ...(resource.sourcePath === undefined
        ? {}
        : { sourcePath: resource.sourcePath }),
      content:
        resource.mediaType.startsWith("text/") ||
        resource.mediaType === "application/json"
          ? Buffer.from(resource.contentBase64, "base64").toString("utf8")
          : `<${resource.byteLength} bytes; base64 omitted from terminal display>`,
    })),
  };
  return JSON.stringify(inspectable, null, 2);
}

function preview(text: string): string {
  const oneLine = text.replace(/\s+/gu, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}
