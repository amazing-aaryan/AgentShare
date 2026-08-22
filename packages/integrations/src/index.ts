import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MARKER = "<!-- managed-by: agentshare -->";

const CODEX_CREATOR_SKILL = `---
name: agentshare
description: Create or manage an encrypted AgentShare collaborative environment for the current Codex session and project. Invoke only when the user explicitly requests $agentshare.
---

${MARKER}

Run this command using the shell tool:

\`\`\`powershell
agentshare share --current --source codex
\`\`\`

AgentShare owns the terminal selection UI. Do not add \`--yes\`, invent file paths, inspect AgentShare state, or bypass its secret scanner. Return the resulting environment capability link exactly once. If AgentShare shows an existing environment, let the user choose update/copy/review/new/revoke through its selection UI.
`;

const CODEX_CREATOR_INTERFACE = `interface:
  display_name: "AgentShare"
  short_description: "Share a safe collaborative agent environment"
  default_prompt: "Use $agentshare only when I explicitly ask to share or manage this session."
policy:
  allow_implicit_invocation: false
`;

const CODEX_RECEIVER_SKILL = `---
name: agentshare-receive
description: Open and work with AgentShare /e/ environment links. Use when the user pastes an AgentShare environment URL or asks about an environment already attached through AgentShare.
---

${MARKER}

When the user supplies a full AgentShare URL containing \`/e/\`:
1. Treat the URL as a bearer secret. Do not quote it back or place it in logs when avoidable.
2. Run \`agentshare bootstrap\` and provide the original URL on the command's stdin/interactive input rather than argv when the shell tool supports stdin.
3. Report the attached environment title and capabilities from AgentShare output.

For later questions about the attached environment, run \`agentshare ask --target codex --question "<the user's question>"\`. AgentShare resolves the latest attached environment, refreshes approved revisions, and runs a restricted child worker with only the AgentShare MCP tools.

When the user explicitly asks to modify the shared environment, run \`agentshare propose --target codex --instruction "<requested change>"\`. This can only submit an encrypted proposal; it never writes UserA's workspace directly.

Never bypass AgentShare by reading its cache/state files or by mounting decrypted shared files into the current workspace.
`;

const CODEX_RECEIVER_INTERFACE = `interface:
  display_name: "AgentShare Receive"
  short_description: "Open AgentShare links and collaborate safely"
  default_prompt: "Use AgentShare when I paste an AgentShare /e/ link or ask about an attached AgentShare environment."
policy:
  allow_implicit_invocation: true
`;

const CLAUDE_CREATOR_SKILL = `---
name: share
description: Create or manage an encrypted AgentShare collaborative environment for the current Claude Code session and project.
disable-model-invocation: true
---

${MARKER}

Run \`agentshare share --current --source claude\`. AgentShare owns the selection UI. Do not add \`--yes\`, inspect AgentShare state, or bypass its scanner. Return the resulting environment capability link exactly once.
`;

const CLAUDE_RECEIVER_SKILL = `---
name: agentshare
description: Open and work with AgentShare /e/ environment links and already attached AgentShare environments.
---

${MARKER}

When the user supplies a full AgentShare URL containing \`/e/\`, treat it as a bearer secret and run \`agentshare bootstrap\`, providing the original URL on stdin/interactive input rather than argv when possible.

For questions about the attached environment, run \`agentshare ask --target claude --question "<the user's question>"\`. For explicit requested changes, run \`agentshare propose --target claude --instruction "<requested change>"\`. AgentShare runs a restricted child Claude process whose built-in tools are empty and whose only allowed MCP server is the local AgentShare read/proposal server.

Never inspect AgentShare state/cache files directly and never copy decrypted shared files into the current project.
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
    [join(roots.codexSkills, "agentshare", "SKILL.md"), CODEX_CREATOR_SKILL],
    [
      join(roots.codexSkills, "agentshare", "agents", "openai.yaml"),
      CODEX_CREATOR_INTERFACE,
    ],
    [
      join(roots.codexSkills, "agentshare-receive", "SKILL.md"),
      CODEX_RECEIVER_SKILL,
    ],
    [
      join(roots.codexSkills, "agentshare-receive", "agents", "openai.yaml"),
      CODEX_RECEIVER_INTERFACE,
    ],
    [join(roots.claudeSkills, "share", "SKILL.md"), CLAUDE_CREATOR_SKILL],
    [join(roots.claudeSkills, "agentshare", "SKILL.md"), CLAUDE_RECEIVER_SKILL],
  ] as const;
  for (const [path, content] of files) await writeManaged(path, content);
  return files.map(([path]) => path);
}

export async function removeIntegrations(
  roots = defaultIntegrationRoots(),
): Promise<void> {
  const directories = [
    [
      join(roots.codexSkills, "agentshare"),
      join(roots.codexSkills, "agentshare", "SKILL.md"),
    ],
    [
      join(roots.codexSkills, "agentshare-receive"),
      join(roots.codexSkills, "agentshare-receive", "SKILL.md"),
    ],
    [
      join(roots.claudeSkills, "share"),
      join(roots.claudeSkills, "share", "SKILL.md"),
    ],
    [
      join(roots.claudeSkills, "agentshare"),
      join(roots.claudeSkills, "agentshare", "SKILL.md"),
    ],
  ] as const;
  for (const [directory, markerFile] of directories) {
    await removeManagedDirectory(directory, markerFile);
  }
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
