import { keyFromFragment, keyToFragment } from "./crypto.js";

export type EnvironmentUrlParts = {
  origin: string;
  environmentId: string;
  readCapability: string;
  environmentMasterKey: Uint8Array;
  proposalCapability?: string;
};

export function buildEnvironmentUrl(parts: EnvironmentUrlParts): string {
  const origin = new URL(parts.origin);
  if (origin.protocol !== "https:" && !isLoopback(origin.hostname)) {
    throw new Error("AgentShare environment URLs require HTTPS except on loopback");
  }
  assertId(parts.environmentId);
  assertCapability(parts.readCapability, "read capability");
  if (parts.proposalCapability !== undefined) {
    assertCapability(parts.proposalCapability, "proposal capability");
  }
  const url = new URL(`/e/${encodeURIComponent(parts.environmentId)}`, origin.origin);
  const fragment = new URLSearchParams();
  fragment.set("r", parts.readCapability);
  fragment.set("k", keyToFragment(parts.environmentMasterKey));
  if (parts.proposalCapability !== undefined) fragment.set("p", parts.proposalCapability);
  url.hash = fragment.toString();
  return url.toString();
}

export function parseEnvironmentUrl(value: string): {
  environmentId: string;
  readCapability: string;
  environmentMasterKey: Uint8Array;
  proposalCapability?: string;
  safeUrl: string;
} {
  const url = new URL(value);
  if (url.protocol !== "https:" && !isLoopback(url.hostname)) {
    throw new Error("AgentShare environment URLs require HTTPS except on loopback");
  }
  const match = /^\/e\/([A-Za-z][A-Za-z0-9_-]{19,99})$/u.exec(url.pathname);
  if (match?.[1] === undefined) throw new Error("Invalid AgentShare environment URL");
  const fragment = new URLSearchParams(url.hash.slice(1));
  const readCapability = fragment.get("r") ?? "";
  const key = fragment.get("k") ?? "";
  const proposalCapability = fragment.get("p") ?? undefined;
  assertCapability(readCapability, "read capability");
  if (proposalCapability !== undefined) assertCapability(proposalCapability, "proposal capability");
  const safe = new URL(url.toString());
  safe.hash = "";
  safe.search = "";
  return {
    environmentId: match[1],
    readCapability,
    environmentMasterKey: keyFromFragment(key),
    ...(proposalCapability === undefined ? {} : { proposalCapability }),
    safeUrl: safe.toString().replace(/\/$/u, ""),
  };
}

function assertId(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]{19,99}$/u.test(value)) {
    throw new Error("Invalid AgentShare environment id");
  }
}

function assertCapability(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{20,100}$/u.test(value)) throw new Error(`Invalid ${label}`);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
