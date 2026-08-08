import { createHash } from "node:crypto";
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
  { kind: "openai-api-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu },
  { kind: "anthropic-api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/gu },
  {
    kind: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/gu,
  },
  { kind: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
  {
    kind: "generic-secret",
    pattern:
      /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}["']?/giu,
  },
];

export function scanAndRedact(input: AcbManifest): ScanResult {
  const manifest = structuredClone(acbManifestSchema.parse(input));
  const findings: SecretFinding[] = [];

  manifest.events = manifest.events.map((event) => ({
    ...event,
    text: redact(event.text, `events[${event.sequence}].text`, findings),
  }));
  manifest.resources = manifest.resources.map((resource, index) => {
    if (
      !resource.mediaType.startsWith("text/") &&
      resource.mediaType !== "application/json"
    ) {
      return resource;
    }
    const original = Buffer.from(resource.contentBase64, "base64").toString(
      "utf8",
    );
    const redacted = redact(original, `resources[${index}].content`, findings);
    const bytes = Buffer.from(redacted, "utf8");
    return {
      ...resource,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentBase64: bytes.toString("base64"),
    };
  });

  return { manifest, findings };
}

function redact(
  text: string,
  location: string,
  findings: SecretFinding[],
): string {
  let result = text;
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
