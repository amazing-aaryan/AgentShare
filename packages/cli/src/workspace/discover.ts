import { realpath, stat } from "node:fs/promises";

export async function discoverWorkspaceRoot(cwd: string): Promise<string> {
  const root = await realpath(cwd);
  const metadata = await stat(root);
  if (!metadata.isDirectory()) {
    throw new Error("AgentShare workspace root must be a directory");
  }
  return root;
}
