import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export type TargetAgent = "codex" | "claude";
export type TargetResult = { exitCode: number; output: string };

const SUPPORTED_VERSIONS: Record<TargetAgent, RegExp> = {
  codex: /^codex-cli 0\.145\./u,
  claude: /^2\.1\.210(?:\s|$)/u,
};

const compatibilityChecks = new Map<TargetAgent, Promise<void>>();

export function codexArgs(
  workspace: string,
  disabledSkillPaths: string[] = [],
): string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "-C",
    workspace,
    "-c",
    'approval_policy="never"',
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    'default_permissions="agentshare-query"',
    "-c",
    'permissions.agentshare-query.filesystem={":minimal"="deny",":workspace_roots"="deny"}',
    "-c",
    "permissions.agentshare-query.network.enabled=false",
    "-c",
    'web_search="disabled"',
    "-c",
    "features.shell_tool=false",
    "-c",
    "features.unified_exec=false",
    "-c",
    "features.apply_patch_freeform=false",
    "-c",
    "features.js_repl=false",
    "-c",
    "features.code_mode=false",
    "-c",
    "features.code_mode_only=false",
    "-c",
    "features.skill_search=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.apps=false",
    "-c",
    "features.hooks=false",
    "-c",
    "features.memories=false",
    ...(disabledSkillPaths.length === 0
      ? []
      : ["-c", disabledSkillsConfig(disabledSkillPaths)]),
    "-",
  ];
}

export function claudeArgs(): string[] {
  return [
    "-p",
    "--no-session-persistence",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-chrome",
    "--permission-mode",
    "dontAsk",
  ];
}

export async function runTarget(
  target: TargetAgent,
  prompt: string,
): Promise<TargetResult> {
  const workspace = await mkdtemp(join(tmpdir(), "agentshare-query-"));
  try {
    const executable = resolveAgentExecutable(target);
    await assertSupportedTarget(target, executable);
    const args =
      target === "codex"
        ? codexArgs(workspace, await discoverUserSkills())
        : claudeArgs();
    const child = spawn(
      executable.command,
      [...executable.prefixArgs, ...args],
      {
        cwd: workspace,
        env: safeEnvironment(),
        stdio: ["pipe", "pipe", "inherit"],
        windowsHide: true,
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      process.stdout.write(chunk);
      output = `${output}${chunk}`.slice(-16_000);
    });
    child.stdin.end(prompt);
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    return { exitCode, output: output.trim() };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export function supportsTargetVersion(
  target: TargetAgent,
  versionOutput: string,
): boolean {
  return SUPPORTED_VERSIONS[target].test(versionOutput.trim());
}

async function assertSupportedTarget(
  target: TargetAgent,
  executable: AgentExecutable,
): Promise<void> {
  let check = compatibilityChecks.get(target);
  if (check === undefined) {
    check = inspectTargetVersion(target, executable);
    compatibilityChecks.set(target, check);
  }
  await check;
}

async function inspectTargetVersion(
  target: TargetAgent,
  executable: AgentExecutable,
): Promise<void> {
  const output = await captureProcess(executable.command, [
    ...executable.prefixArgs,
    "--version",
  ]);
  if (!supportsTargetVersion(target, output)) {
    throw new Error(
      `Unsupported ${target} version: ${output.trim() || "unknown"}. ` +
        "AgentShare fails closed until this version passes isolation review.",
    );
  }
}

async function captureProcess(
  command: string,
  args: string[],
): Promise<string> {
  const child = spawn(command, args, {
    env: safeEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`Unable to inspect target version: ${stderr.trim()}`);
  }
  return stdout || stderr;
}

export async function discoverUserSkills(home = homedir()): Promise<string[]> {
  const roots = [
    join(home, ".codex", "skills"),
    join(home, ".agents", "skills"),
  ];
  const found: string[] = [];
  for (const root of roots) found.push(...(await findSkillFiles(root)));
  return found.sort((a, b) => a.localeCompare(b, "en"));
}

function disabledSkillsConfig(paths: string[]): string {
  const entries = paths.map(
    (path) => `{path=${JSON.stringify(path)},enabled=false}`,
  );
  return `skills.config=[${entries.join(",")}]`;
}

async function findSkillFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return found;
    throw error;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await findSkillFiles(path)));
    else if (entry.isFile() && entry.name === "SKILL.md") found.push(path);
  }
  return found;
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

type AgentExecutable = { command: string; prefixArgs: string[] };

export function resolveAgentExecutable(
  target: TargetAgent,
  environment: NodeJS.ProcessEnv = process.env,
): AgentExecutable {
  if (process.platform !== "win32") return { command: target, prefixArgs: [] };
  const pathEntries = (environment.PATH ?? environment.Path ?? "")
    .split(";")
    .filter(Boolean);
  for (const directory of pathEntries) {
    const executable = join(directory, `${target}.exe`);
    if (existsSync(executable)) return { command: executable, prefixArgs: [] };
    if (target === "codex" && existsSync(join(directory, "codex.cmd"))) {
      const entrypoint = join(
        directory,
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js",
      );
      if (existsSync(entrypoint)) {
        return { command: process.execPath, prefixArgs: [entrypoint] };
      }
    }
  }
  throw new Error(`${target} CLI executable not found on PATH`);
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const allow = new Set([
    "PATH",
    "Path",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "TMP",
    "TEMP",
    "TERM",
    "COLORTERM",
    "NO_COLOR",
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => allow.has(key) && value !== undefined,
    ),
  );
}
