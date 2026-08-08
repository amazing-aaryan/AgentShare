import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { AcbManifest } from "@agentshare/contracts";

export async function manifestFromTextFile(
  path: string,
  sourceAgent: AcbManifest["sourceAgent"] = "generic",
): Promise<AcbManifest> {
  const bytes = await readFile(path);
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw new Error("Input exceeds 5 MiB source limit");
  return {
    version: "acb-v1",
    title: basename(path),
    sourceAgent,
    exportedAt: new Date().toISOString(),
    events: [
      {
        sequence: 0,
        role: "system",
        kind: "message",
        text: bytes.toString("utf8"),
        sourceId: basename(path),
      },
    ],
    resources: [],
  };
}
