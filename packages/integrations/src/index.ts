import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MARKER = "<!-- managed-by: agentshare -->";

const CODEX_SKILL = `---
name: agentshare
description: Share selected current Codex context through an encrypted AgentShare capability link. Invoke only when user explicitly requests $agentshare.
---

${MARKER}

Run this command using the shell tool:

\`\`\`powershell
agentshare share --current --source codex
\`\`\`

Let creator inspect normalized payload, redactions, fingerprint, expiry, and limits. Never add \`--yes\`. Return resulting capability link exactly once. Never inspect or log local AgentShare state.
`;

const CODEX_INTERFACE = `interface:
  display_name: "AgentShare"
  short_description: "Encrypt and share current agent context"
  default_prompt: "Use $agentshare only when I explicitly ask to share this session."
policy:
  allow_implicit_invocation: false
`;

const CLAUDE_SKILL = `---
name: share
description: Encrypt and share selected current Claude Code context through AgentShare.
disable-model-invocation: true
---

${MARKER}

Run \`agentshare share --current --source claude\`. Let creator inspect normalized payload, redactions, fingerprint, expiry, and limits. Never add \`--yes\`. Return resulting capability link exactly once. Never inspect or log local AgentShare state.
`;

export type IntegrationRoots = {
  codexSkills: string;
  claudeSkills: string;
};

export function defaultIntegrationRoots(): IntegrationRoots {
  return {
    codexSkills: join(homedir(), ".agents", "skills"),
    claudeSkills: join(homedir(), ".claude", "skills"),
  };
}

export async function installIntegrations(
  roots = defaultIntegrationRoots(),
): Promise<string[]> {
  const files = [
    [join(roots.codexSkills, "agentshare", "SKILL.md"), CODEX_SKILL],
    [
      join(roots.codexSkills, "agentshare", "agents", "openai.yaml"),
      CODEX_INTERFACE,
    ],
    [join(roots.claudeSkills, "share", "SKILL.md"), CLAUDE_SKILL],
  ] as const;
  for (const [path, content] of files) await writeManaged(path, content);
  return files.map(([path]) => path);
}

export async function removeIntegrations(
  roots = defaultIntegrationRoots(),
): Promise<void> {
  const codex = join(roots.codexSkills, "agentshare");
  const claude = join(roots.claudeSkills, "share");
  await removeManagedDirectory(codex, join(codex, "SKILL.md"));
  await removeManagedDirectory(claude, join(claude, "SKILL.md"));
}

async function writeManaged(path: string, content: string): Promise<void> {
  try {
    const existing = await readFile(path, "utf8");
    if (existing === content) return;
    if (!existing.includes(MARKER) && path.endsWith("SKILL.md")) {
      throw new Error(`Refusing to overwrite unmanaged integration: ${path}`);
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function removeManagedDirectory(
  directory: string,
  markerFile: string,
): Promise<void> {
  try {
    const content = await readFile(markerFile, "utf8");
    if (!content.includes(MARKER))
      throw new Error(`Refusing to remove unmanaged integration: ${directory}`);
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
