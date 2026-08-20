import { normalizeSecureOrigin } from "./capabilities.js";
import { keyFromFragment, keyToFragment } from "./crypto.js";

type EnvironmentCapabilityFields = {
  environmentId: string;
  readCapability: string;
  environmentMasterKey: Uint8Array;
  proposalCapability?: string;
};

type LegacyEnvironmentUrlParts = EnvironmentCapabilityFields & {
  origin: string;
  handoffOrigin?: never;
  relayOrigin?: never;
};

type SplitEnvironmentUrlParts = EnvironmentCapabilityFields & {
  handoffOrigin: string;
  relayOrigin: string;
  origin?: never;
};

export type EnvironmentUrlParts =
  | LegacyEnvironmentUrlParts
  | SplitEnvironmentUrlParts;

export function buildEnvironmentUrl(parts: EnvironmentUrlParts): string {
  const handoffOrigin = normalizeSecureOrigin(
    "origin" in parts ? parts.origin : parts.handoffOrigin,
  );
  assertId(parts.environmentId);
  assertCapability(parts.readCapability, "read capability");
  if (parts.proposalCapability !== undefined) {
    assertCapability(parts.proposalCapability, "proposal capability");
  }
  const url = new URL(
    `/e/${encodeURIComponent(parts.environmentId)}`,
    handoffOrigin,
  );
  if (!("origin" in parts)) {
    url.searchParams.set("relay", normalizeSecureOrigin(parts.relayOrigin));
  }
  const fragment = new URLSearchParams();
  fragment.set("r", parts.readCapability);
  fragment.set("k", keyToFragment(parts.environmentMasterKey));
  if (parts.proposalCapability !== undefined) {
    fragment.set("p", parts.proposalCapability);
  }
  url.hash = fragment.toString();
  return url.toString();
}

export function parseEnvironmentUrl(value: string): {
  environmentId: string;
  readCapability: string;
  environmentMasterKey: Uint8Array;
  proposalCapability?: string;
  handoffOrigin: string;
  relayOrigin: string;
  safeUrl: string;
} {
  const url = new URL(value);
  const handoffOrigin = normalizeSecureOrigin(url.origin);
  const match = /^\/e\/([A-Za-z][A-Za-z0-9_-]{19,99})$/u.exec(url.pathname);
  if (match?.[1] === undefined) {
    throw new Error("Invalid AgentShare environment URL");
  }
  for (const key of url.searchParams.keys()) {
    if (key !== "relay") {
      throw new Error("Invalid AgentShare environment URL query");
    }
  }
  const relayValue = url.searchParams.get("relay");
  const relayOrigin =
    relayValue === null ? handoffOrigin : normalizeSecureOrigin(relayValue);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const readCapability = fragment.get("r") ?? "";
  const key = fragment.get("k") ?? "";
  const proposalCapability = fragment.get("p") ?? undefined;
  assertCapability(readCapability, "read capability");
  if (proposalCapability !== undefined) {
    assertCapability(proposalCapability, "proposal capability");
  }
  const safe = new URL(url.toString());
  safe.hash = "";
  return {
    environmentId: match[1],
    readCapability,
    environmentMasterKey: keyFromFragment(key),
    ...(proposalCapability === undefined ? {} : { proposalCapability }),
    handoffOrigin,
    relayOrigin,
    safeUrl: safe.toString().replace(/\/$/u, ""),
  };
}

function assertId(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]{19,99}$/u.test(value)) {
    throw new Error("Invalid AgentShare environment id");
  }
}

function assertCapability(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{20,100}$/u.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}
