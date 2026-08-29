import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeTerminalText } from "./terminal.js";

export type TargetAgent = "codex" | "claude";
export type TargetResult = { exitCode: number; output: string };

type TargetChildLifecycle = {
  once(event: "error", listener: (error: Error) => void): TargetChildLifecycle;
  once(
    event: "close",
    listener: (code: number | null) => void,
  ): TargetChildLifecycle;
};

type VersionTuple = readonly [major: number, minor: number, patch: number];

const MINIMUM_CODEX_VERSION: VersionTuple = [0, 145, 0];
const CODEX_VERSION_PATTERN =
  /^codex-cli\s+(\d+)\.(\d+)\.(\d+)(?:[-+][^\s]+)?\s*$/mu;

const TARGET_CONTRACTS: Record<
  TargetAgent,
  { helpArgs: string[]; requiredHelpOptions: string[]; versionPattern: RegExp }
> = {
  codex: {
    helpArgs: ["exec", "--help"],
    requiredHelpOptions: [
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--strict-config",
      "--skip-git-repo-check",
      "--cd",
      "--config",
    ],
    versionPattern: CODEX_VERSION_PATTERN,
  },
  claude: {
    helpArgs: ["--help"],
    requiredHelpOptions: [
      "--print",
      "--no-session-persistence",
      "--tools",
      "--strict-mcp-config",
      "--mcp-config",
      "--setting-sources",
      "--disable-slash-commands",
      "--no-chrome",
      "--permission-mode",
    ],
    versionPattern: /^\d+\.\d+\.\d+(?:[-+][^\s]+)?\s+\(Claude Code\)\s*$/mu,
  },
};

const REVIEWED_CLAUDE_VERSIONS =
  /^2\.1\.(?:210|211|212|213|214|215|216|217|218|219|220|221|222|223|224|225|226|227|228|229|231|238)\s+\(Claude Code\)\s*$/mu;

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
    "--cd",
    workspace,
    "--config",
    'approval_policy="never"',
    "--config",
    'sandbox_mode="read-only"',
    "--config",
    'default_permissions="agentshare-query"',
    "--config",
    'permissions.agentshare-query.filesystem={":minimal"="deny",":workspace_roots"="deny"}',
    "--config",
    "permissions.agentshare-query.network.enabled=false",
    "--config",
    'web_search="disabled"',
    "--config",
    "features.shell_tool=false",
    "--config",
    "features.unified_exec=false",
    "--config",
    "features.apply_patch_freeform=false",
    "--config",
    "features.js_repl=false",
    "--config",
    "features.code_mode=false",
    "--config",
    "features.code_mode_only=false",
    "--config",
    "features.skill_search=false",
    "--config",
    "features.plugins=false",
    "--config",
    "features.apps=false",
    "--config",
    "features.hooks=false",
    "--config",
    "features.memories=false",
    ...(disabledSkillPaths.length === 0
      ? []
      : ["--config", disabledSkillsConfig(disabledSkillPaths)]),
    "-",
  ];
}

export function claudeArgs(): string[] {
  return [
    "--print",
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
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const sanitized = sanitizeTerminalText(chunk);
      if (!process.stdout.write(sanitized)) {
        child.stdout.pause();
        process.stdout.once("drain", () => child.stdout.resume());
      }
      output = `${output}${sanitized}`.slice(-16_000);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const sanitized = sanitizeTerminalText(chunk);
      if (!process.stderr.write(sanitized)) {
        child.stderr.pause();
        process.stderr.once("drain", () => child.stderr.resume());
      }
    });
    child.stdin.end(prompt);
    const exitCode = await waitForTargetClose(child);
    return { exitCode, output: output.trim() };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function verifyTarget(target: TargetAgent): Promise<void> {
  const executable = resolveAgentExecutable(target);
  await assertSupportedTarget(target, executable);
}

export function waitForTargetClose(
  child: TargetChildLifecycle,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export function recognizesTargetVersion(
  target: TargetAgent,
  versionOutput: string,
): boolean {
  return TARGET_CONTRACTS[target].versionPattern.test(versionOutput.trim());
}

export function unsupportedTargetVersionMessage(
  target: TargetAgent,
  versionOutput: string,
): string {
  return (
    `Unrecognized ${target} CLI version output: ${displayTargetOutput(versionOutput)}. ` +
    `AgentShare requires a recognizable ${target} CLI and fails closed for unknown executables.`
  );
}

export function missingTargetCapabilities(
  target: TargetAgent,
  helpOutput: string,
): string[] {
  const advertised = new Set(
    helpOutput
      .split(/\r?\n/u)
      .filter((line) => line.trimStart().startsWith("-"))
      .flatMap((line) => line.match(/--[a-z][a-z0-9-]*/giu) ?? []),
  );
  return TARGET_CONTRACTS[target].requiredHelpOptions.filter(
    (option) => !advertised.has(option),
  );
}

export function unsupportedTargetCapabilitiesMessage(
  target: TargetAgent,
  versionOutput: string,
  missing: string[],
): string {
  return (
    `${target} ${displayTargetOutput(versionOutput)} lacks required isolation controls: ` +
    `${missing.join(", ")}. Update ${target}; AgentShare will not weaken its sandbox.`
  );
}

export function supportsReviewedTargetVersion(
  target: TargetAgent,
  versionOutput: string,
): boolean {
  if (target === "claude") {
    return REVIEWED_CLAUDE_VERSIONS.test(versionOutput.trim());
  }
  const version = parseCodexVersion(versionOutput);
  return version !== undefined && compareVersions(version, MINIMUM_CODEX_VERSION) >= 0;
}

async function assertSupportedTarget(
  target: TargetAgent,
  executable: AgentExecutable,
): Promise<void> {
  await inspectTargetVersion(target, executable);
}

async function inspectTargetVersion(
  target: TargetAgent,
  executable: AgentExecutable,
): Promise<void> {
  const contract = TARGET_CONTRACTS[target];
  const output = await captureProcess(executable.command, [
    ...executable.prefixArgs,
    "--version",
  ]);
  if (!recognizesTargetVersion(target, output)) {
    throw new Error(unsupportedTargetVersionMessage(target, output));
  }
  if (!supportsReviewedTargetVersion(target, output)) {
    if (target === "codex") {
      throw new Error(
        `codex ${displayTargetOutput(output)} requires Codex CLI >= 0.145.0. ` +
          "Update Codex; AgentShare will not run against an older recipient sandbox.",
      );
    }
    throw new Error(
      `${target} ${displayTargetOutput(output)} has not passed AgentShare isolation review. ` +
        `Update AgentShare or install a reviewed ${target} version; sandbox controls will not be assumed safe.`,
    );
  }
  const help = await captureProcess(executable.command, [
    ...executable.prefixArgs,
    ...contract.helpArgs,
  ]);
  const missing = missingTargetCapabilities(target, help);
  if (missing.length > 0) {
    throw new Error(
      unsupportedTargetCapabilitiesMessage(target, output, missing),
    );
  }
}

function parseCodexVersion(versionOutput: string): VersionTuple | undefined {
  const match = CODEX_VERSION_PATTERN.exec(versionOutput.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: VersionTuple, right: VersionTuple): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function captureProcess(
  command: string,
  args: string[],
  timeoutMs = 15_000,
  maxOutputBytes = 1_048_576,
): Promise<string> {
  const child = spawn(command, args, {
    detached: process.platform !== "win32",
    env: safeEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, exitCode = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) reject(error);
      else if (exitCode !== 0) {
        reject(
          new Error(
            `Unable to inspect target compatibility: ${displayTargetOutput(stderr)}`,
          ),
        );
      } else resolve(`${stdout}\n${stderr}`.trim());
    };
    const abort = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.stdout.destroy();
      child.stderr.destroy();
      terminateProcessTree(child);
      reject(error);
    };
    const append = (stream: "stdout" | "stderr", chunk: string) => {
      if (settled) return;
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > maxOutputBytes) {
        abort(
          new Error(
            `Target compatibility output exceeded ${maxOutputBytes} bytes`,
          ),
        );
        return;
      }
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    const timer = setTimeout(
      () =>
        abort(
          new Error(
            `Target compatibility check timed out after ${timeoutMs} ms`,
          ),
        ),
      timeoutMs,
    );
    child.stdout.on("data", (chunk: string) => append("stdout", chunk));
    child.stderr.on("data", (chunk: string) => append("stderr", chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(undefined, code ?? 1));
  });
}

function terminateProcessTree(child: Pick<ChildProcess, "kill" | "pid">): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } catch {
      // Direct termination below remains the fallback.
    }
  } else if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Direct termination below remains the fallback.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Promise already failed closed; no later close event is required.
  }
}

function displayTargetOutput(output: string): string {
  return sanitizeTerminalText(output).trim().slice(0, 512) || "unknown";
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
