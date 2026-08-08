import { createHash, randomBytes } from "node:crypto";

export function randomCapability(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function capabilityDigest(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex");
}

export function buildShareUrl(args: {
  origin: string;
  shareId: string;
  readCapability: string;
  fragmentKey: string;
}): string {
  const url = new URL(`/s/${encodeURIComponent(args.shareId)}`, args.origin);
  url.searchParams.set("r", args.readCapability);
  url.hash = `k=${args.fragmentKey}`;
  return url.toString();
}

export function parseShareUrl(value: string): {
  shareId: string;
  readCapability: string;
  fragmentKey: string;
  safeUrl: string;
} {
  const url = new URL(value);
  const match = /^\/s\/([^/]+)$/u.exec(url.pathname);
  const readCapability = url.searchParams.get("r");
  const fragment = new URLSearchParams(url.hash.slice(1));
  const fragmentKey = fragment.get("k");
  if (!match?.[1] || !readCapability || !fragmentKey) {
    throw new Error("Invalid AgentShare capability URL");
  }
  url.hash = "";
  return {
    shareId: decodeURIComponent(match[1]),
    readCapability,
    fragmentKey,
    safeUrl: url.toString(),
  };
}
