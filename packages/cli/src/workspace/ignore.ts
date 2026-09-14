import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizedWorkspacePath } from "./policy.js";

export type IgnoreMatcher = (path: string, isDirectory: boolean) => boolean;

export async function loadAgentShareIgnore(
  root: string,
): Promise<IgnoreMatcher> {
  let content = "";
  try {
    content = await readFile(join(root, ".agentshareignore"), "utf8");
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
  const patterns = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .filter((line) => !line.startsWith("!"))
    .map(compilePattern);
  return (path, isDirectory) =>
    patterns.some((pattern) => pattern(path, isDirectory));
}

function compilePattern(pattern: string): IgnoreMatcher {
  const directoryOnly = pattern.endsWith("/");
  const raw = pattern.replace(/^\//u, "").replace(/\/$/u, "");
  const normalized = normalizedWorkspacePath(raw);
  const hasSlash = normalized.includes("/");
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*\*/gu, "§§DOUBLESTAR§§")
    .replace(/\*/gu, "[^/]*")
    .replace(/§§DOUBLESTAR§§/gu, ".*")
    .replace(/\?/gu, "[^/]");
  const regex = hasSlash
    ? new RegExp(`^${escaped}(?:/.*)?$`, "u")
    : new RegExp(`(?:^|/)${escaped}(?:/.*)?$`, "u");
  return (path, isDirectory) =>
    (!directoryOnly || isDirectory) && regex.test(path);
}
