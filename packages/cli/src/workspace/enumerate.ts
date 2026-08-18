import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { listGitShareableFiles } from "./git.js";
import { loadAgentShareIgnore } from "./ignore.js";
import {
  excludedByPolicy,
  normalizedWorkspacePath,
  type ExclusionReason,
} from "./policy.js";

export type EnumeratedWorkspace = {
  files: string[];
  excluded: Array<{ path: string; reason: ExclusionReason }>;
};

export async function enumerateWorkspace(
  root: string,
  options: { preferGit?: boolean } = {},
): Promise<EnumeratedWorkspace> {
  const canonicalRoot = await realpath(root);
  const ignore = await loadAgentShareIgnore(canonicalRoot);
  const excluded: EnumeratedWorkspace["excluded"] = [];
  const gitFiles =
    options.preferGit === false
      ? undefined
      : await listGitShareableFiles(canonicalRoot);
  const candidates = gitFiles ?? (await recurse(canonicalRoot));
  const files: string[] = [];

  for (const candidate of candidates) {
    let path: string;
    try {
      path = normalizedWorkspacePath(candidate);
    } catch {
      excluded.push({ path: candidate, reason: "unsupported-file-type" });
      continue;
    }
    const policy = excludedByPolicy(path);
    if (policy !== undefined) {
      excluded.push({ path, reason: policy });
      continue;
    }
    if (ignore(path, false)) {
      excluded.push({ path, reason: "ignored" });
      continue;
    }
    const absolute = resolve(canonicalRoot, path);
    if (!isInside(canonicalRoot, absolute)) {
      excluded.push({ path, reason: "unsupported-file-type" });
      continue;
    }
    let metadata;
    try {
      metadata = await lstat(absolute);
    } catch {
      excluded.push({ path, reason: "unsupported-file-type" });
      continue;
    }
    if (metadata.isSymbolicLink()) {
      excluded.push({ path, reason: "symlink" });
      continue;
    }
    if (!metadata.isFile()) {
      excluded.push({ path, reason: "unsupported-file-type" });
      continue;
    }
    const canonicalFile = await realpath(absolute);
    if (!isInside(canonicalRoot, canonicalFile)) {
      excluded.push({ path, reason: "unsupported-file-type" });
      continue;
    }
    files.push(path);
  }

  return {
    files: [...new Set(files)].sort((a, b) => a.localeCompare(b, "en")),
    excluded: excluded.sort((a, b) => a.path.localeCompare(b.path, "en")),
  };
}

async function recurse(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = normalizedWorkspacePath(relative(root, absolute));
      const policy = excludedByPolicy(path);
      if (policy !== undefined) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        found.push(path);
      }
    }
  }
  await visit(root);
  return found;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
