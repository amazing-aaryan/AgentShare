import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { securePrivatePath } from "./private-files.js";
export { ensurePrivateDirectory, securePrivatePath } from "./private-files.js";

const MARKER = "<!-- managed-by: agentshare -->";

const CODEX_CREATOR_SKILL = `---
name: agentshare
description: Create or manage an encrypted AgentShare collaborative environment for the current Codex session and project. Invoke only when the user explicitly requests $agentshare.
---

${MARKER}

Use the connected AgentShare creator MCP tools in this conversation. Never publish from an agent-supplied approval flag.

1. Run \`agentshare session-context\` through this session's shell. It returns only the current thread ID and cwd. Do not search transcript files or select the newest session.
2. Call \`resolve_creator_session\` with that exact thread ID. Ask which scope (conversation/project/both), access (read/read+propose), and expiry the user wants. If the recorded project moved, explicitly choose the replacement root; never infer it from a matching folder name.
3. Call \`prepare_share\`, then show the authoritative summary and offer \`review_share\` pages. Preparation is local only.
4. Call \`commit_share\` for that exact draft/digest. The server requests native human confirmation. Never accept or simulate this confirmation on the user's behalf. Decline, cancellation, unsupported host, or timeout permits no new publication writes; an earlier interrupted attempt may still need recovery.
5. Return the resulting capability link exactly once. On uncertain publication use \`share_status\`; do not create another share blindly.

If creator tools are missing, run \`agentshare doctor\`. Reload MCP servers when supported; otherwise tell the user a host restart is required. Do not open an empty terminal or claim current-session activation without seeing the tools.

Terminal fallback for an already prepared draft is \`agentshare review --draft <returned-id> --digest <returned-digest>\`. The user reviews and confirms in the terminal; the same retained bytes are published.

For a fresh terminal workflow, run:

\`\`\`powershell
agentshare share --current --source codex
\`\`\`

Terminal fallback requires genuine user review. If this shell cannot provide it, explain that limitation. Do not emulate selection, add \`--yes\`, invent paths, inspect AgentShare state, or bypass scanning. Existing-share updates retain permissions; proposal application and revocation require separate user decisions. Claude and non-Windows real-agent workflows remain unverified for this candidate.
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

Run \`agentshare share --current --source claude\`. AgentShare requires an interactive terminal for creator selection and final review. If this shell cannot provide one, stop and ask the user to run that command in a real interactive terminal. Do not emulate the selection, add \`--yes\`, inspect AgentShare state, or bypass its scanner. Return the resulting environment capability link exactly once.
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
  codexConfig?: string;
  codexSkills: string;
  claudeSkills: string;
};

export function defaultIntegrationRoots(): IntegrationRoots {
  return {
    codexConfig: join(
      process.env.CODEX_HOME ?? join(homedir(), ".codex"),
      "config.toml",
    ),
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
  const installed = files.map(([path]) => path);
  if (roots.codexConfig !== undefined) {
    await installCreatorMcpConfiguration(roots.codexConfig);
    installed.push(roots.codexConfig);
  }
  return installed;
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
  if (roots.codexConfig !== undefined)
    await updateCreatorConfig(roots.codexConfig, "");
}

const CONFIG_START = "# >>> agentshare managed creator MCP";
const CONFIG_END = "# <<< agentshare managed creator MCP";

export async function installCreatorMcpConfiguration(
  path: string,
  executable = process.execPath,
  cliPath = process.argv[1],
): Promise<void> {
  if (cliPath === undefined)
    throw new Error("AgentShare CLI path unavailable for MCP installation");
  const block = [
    CONFIG_START,
    "[mcp_servers.agentshare_creator]",
    `command = ${JSON.stringify(executable)}`,
    `args = [${JSON.stringify(cliPath)}, "creator-mcp"]`,
    "enabled = true",
    "required = false",
    "tool_timeout_sec = 180",
    'default_tools_approval_mode = "prompt"',
    "[mcp_servers.agentshare_creator.tools.resolve_creator_session]",
    'approval_mode = "approve"',
    "[mcp_servers.agentshare_creator.tools.review_share]",
    'approval_mode = "approve"',
    "[mcp_servers.agentshare_creator.tools.share_status]",
    'approval_mode = "approve"',
    CONFIG_END,
    "",
  ].join("\n");
  await updateCreatorConfig(path, block);
}

async function updateCreatorConfig(path: string, block: string): Promise<void> {
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNotFound(error)) return "";
    throw error;
  });
  const start = existing.indexOf(CONFIG_START),
    end = existing.indexOf(CONFIG_END);
  if (
    start < 0 !== end < 0 ||
    (start >= 0 && (end < start || existing.includes(CONFIG_START, start + 1)))
  ) {
    throw new Error(
      "Malformed managed AgentShare MCP configuration; repair manually",
    );
  }
  const unmanaged =
    start < 0
      ? existing
      : existing.slice(0, start) +
        existing.slice(end + CONFIG_END.length).replace(/^\r?\n/u, "");
  if (unmanaged.includes("agentshare_creator"))
    throw new Error(
      "Refusing to overwrite unmanaged agentshare_creator MCP configuration",
    );
  const next =
    block === ""
      ? unmanaged
      : `${unmanaged}${unmanaged.endsWith("\n") || unmanaged === "" ? "" : "\n"}${block}`;
  if (next === existing) return;
  await mkdir(dirname(path), { recursive: true });
  if (existing !== "") {
    const backup = `${path}.agentshare-backup`;
    const backupStage = `${path}.${randomUUID()}.backup-tmp`;
    try {
      await writeProtectedConfig(backupStage, existing);
      await link(backupStage, backup);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    } finally {
      await rm(backupStage, { force: true });
    }
    await securePrivatePath(backup);
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeProtectedConfig(temporary, next);
  const current = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNotFound(error)) return "";
    throw error;
  });
  if (current !== existing) {
    await rm(temporary);
    throw new Error("Codex configuration changed during installation; retry");
  }
  await rename(temporary, path);
}

async function writeProtectedConfig(
  path: string,
  content: string,
): Promise<void> {
  // Establish ACL while empty; do not briefly expose copied MCP credentials.
  await writeFile(path, "", { flag: "wx", mode: 0o600 });
  try {
    await securePrivatePath(path);
    await writeFile(path, content);
  } catch (error) {
    await rm(path, { force: true });
    throw error;
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
