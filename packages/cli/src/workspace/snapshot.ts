import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { MAX_RESOURCE_BYTES } from "@agentshare/contracts";
import { discoverWorkspaceRoot } from "./discover.js";
import { enumerateWorkspace } from "./enumerate.js";

export type WorkspaceSnapshotFile = {
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  executable: boolean;
  contentBase64: string;
};

export type WorkspaceSnapshot = {
  root: string;
  rootName: string;
  files: WorkspaceSnapshotFile[];
  excluded: Array<{ path: string; reason: string }>;
  totalBytes: number;
};

export async function buildWorkspaceSnapshot(
  cwd: string,
  options: { preferGit?: boolean; maxFileBytes?: number } = {},
): Promise<WorkspaceSnapshot> {
  const root = await discoverWorkspaceRoot(cwd);
  const maxFileBytes = options.maxFileBytes ?? MAX_RESOURCE_BYTES;
  const enumeration = await enumerateWorkspace(root, {
    ...(options.preferGit === undefined ? {} : { preferGit: options.preferGit }),
  });
  const files: WorkspaceSnapshotFile[] = [];
  const excluded = [...enumeration.excluded];
  let totalBytes = 0;

  for (const path of enumeration.files) {
    const absolute = join(root, ...path.split("/"));
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      excluded.push({
        path,
        reason: metadata.isSymbolicLink() ? "symlink" : "unsupported-file-type",
      });
      continue;
    }
    if (metadata.size > maxFileBytes) {
      excluded.push({ path, reason: "file-too-large" });
      continue;
    }
    const resolved = await realpath(absolute);
    if (resolved !== absolute && process.platform !== "win32") {
      const current = await lstat(absolute);
      if (current.isSymbolicLink()) {
        excluded.push({ path, reason: "symlink" });
        continue;
      }
    }
    const content = await readFile(absolute);
    const sha256 = createHash("sha256").update(content).digest("hex");
    files.push({
      path,
      mediaType: mediaTypeFor(path, content),
      byteLength: content.byteLength,
      sha256,
      executable: (metadata.mode & 0o111) !== 0,
      contentBase64: content.toString("base64"),
    });
    totalBytes += content.byteLength;
  }

  return {
    root,
    rootName: basename(root),
    files,
    excluded: excluded.sort((a, b) => a.path.localeCompare(b.path, "en")),
    totalBytes,
  };
}

function mediaTypeFor(path: string, content: Buffer): string {
  const extension = path.toLowerCase().split(".").at(-1) ?? "";
  const known: Record<string, string> = {
    ts: "text/typescript",
    tsx: "text/typescript-jsx",
    js: "text/javascript",
    jsx: "text/javascript-jsx",
    json: "application/json",
    md: "text/markdown",
    txt: "text/plain",
    yaml: "application/yaml",
    yml: "application/yaml",
    toml: "application/toml",
    css: "text/css",
    html: "text/html",
    py: "text/x-python",
    rs: "text/x-rust",
    go: "text/x-go",
    java: "text/x-java-source",
    c: "text/x-c",
    h: "text/x-c",
    cpp: "text/x-c++",
    sh: "text/x-shellscript",
  };
  const recognized = known[extension];
  if (recognized !== undefined) return recognized;
  const sample = content.subarray(0, Math.min(content.byteLength, 8_192));
  return sample.includes(0) ? "application/octet-stream" : "text/plain";
}
