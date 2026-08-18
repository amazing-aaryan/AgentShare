import { createHash, randomBytes } from "node:crypto";

export function randomCapability(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function capabilityDigest(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex");
}

type CapabilityFields = {
  shareId: string;
  readCapability: string;
  fragmentKey: string;
};

type LegacyShareUrlArgs = CapabilityFields & {
  origin: string;
  handoffOrigin?: never;
  relayOrigin?: never;
};

type SplitShareUrlArgs = CapabilityFields & {
  handoffOrigin: string;
  relayOrigin: string;
  origin?: never;
};

export function buildShareUrl(
  args: LegacyShareUrlArgs | SplitShareUrlArgs,
): string {
  const handoffOrigin = normalizeSecureOrigin(
    "origin" in args ? args.origin : args.handoffOrigin,
  );
  const url = new URL(`/s/${encodeURIComponent(args.shareId)}`, handoffOrigin);
  if (!("origin" in args)) {
    url.searchParams.set("relay", normalizeSecureOrigin(args.relayOrigin));
  }
  url.hash = new URLSearchParams({
    r: args.readCapability,
    k: args.fragmentKey,
  }).toString();
  return url.toString();
}

export function parseShareUrl(value: string): {
  shareId: string;
  readCapability: string;
  fragmentKey: string;
  handoffOrigin: string;
  relayOrigin: string;
  safeUrl: string;
} {
  const url = new URL(value);
  const handoffOrigin = normalizeSecureOrigin(url.origin);
  const match = /^\/s\/([^/]+)$/u.exec(url.pathname);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const readCapability = fragment.get("r") ?? url.searchParams.get("r");
  const fragmentKey = fragment.get("k");
  const relayValue = url.searchParams.get("relay");
  const relayOrigin =
    relayValue === null ? handoffOrigin : normalizeSecureOrigin(relayValue);
  if (!match?.[1] || !readCapability || !fragmentKey) {
    throw new Error("Invalid AgentShare capability URL");
  }
  url.hash = "";
  url.searchParams.delete("r");
  return {
    shareId: decodeURIComponent(match[1]),
    readCapability,
    fragmentKey,
    handoffOrigin,
    relayOrigin,
    safeUrl: url.toString(),
  };
}

export function normalizeSecureOrigin(value: string): string {
  const url = new URL(value);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("AgentShare origins require HTTPS except on loopback");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "AgentShare origin must not include credentials, path, query, or fragment",
    );
  }
  return url.origin;
}
