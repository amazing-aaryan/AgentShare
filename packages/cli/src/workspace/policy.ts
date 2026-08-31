import { posix } from "node:path";

const ALWAYS_EXCLUDED_DIRS = new Set([
  ".git",
  ".agentshare",
  ".agentshare-private",
  "node_modules",
  "vendor",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "coverage",
]);

const CREDENTIAL_NAMES = [
  /^\.env(?:\..+)?$/u,
  /^\.npmrc$/u,
  /^\.pypirc$/u,
  /^credentials(?:\..+)?$/iu,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/u,
  /\.key$/iu,
  /\.pem$/iu,
];

export type ExclusionReason =
  | "reserved-directory"
  | "credential-policy"
  | "symlink"
  | "unsupported-file-type"
  | "file-too-large"
  | "ignored";

export function normalizedWorkspacePath(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) {
    throw new Error("Workspace path must be relative");
  }
  const clean = posix.normalize(normalized);
  if (
    clean === "." ||
    clean === ".." ||
    clean.startsWith("../") ||
    clean.includes("/../")
  ) {
    throw new Error("Workspace path escapes root");
  }
  return clean;
}

export function excludedByPolicy(path: string): ExclusionReason | undefined {
  const normalized = normalizedWorkspacePath(path);
  const parts = normalized.split("/");
  if (parts.some((part) => ALWAYS_EXCLUDED_DIRS.has(part))) {
    return "reserved-directory";
  }
  const name = parts.at(-1) ?? "";
  if (CREDENTIAL_NAMES.some((pattern) => pattern.test(name))) {
    return "credential-policy";
  }
  if (
    parts.includes(".ssh") ||
    parts.includes(".aws") ||
    parts.includes(".gnupg")
  ) {
    return "credential-policy";
  }
  return undefined;
}
