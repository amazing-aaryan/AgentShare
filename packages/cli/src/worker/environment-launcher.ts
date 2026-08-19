import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeArgs,
  codexArgs,
  discoverUserSkills,
  resolveAgentExecutable,
  verifyTarget,
  waitForTargetClose,
  type TargetAgent,
  type TargetResult,
} from "../launchers.js";
import { sanitizeTerminalText } from "../terminal.js";

const MCP_TOOLS = [
  "environment_info",
  "list_files",
  "search",
  "read_file",
  "read_conversation",
  "proposal_stage_replace",
  "proposal_stage_create",
  "proposal_stage_delete",
  "proposal_diff",
  "proposal_submit",
] as const;

export async function runEnvironmentTarget(
  target: TargetAgent,
  environmentId: string,
  prompt: string,
  options: { statePath?: string; cacheRoot?: string } = {},
): Promise<TargetResult> {
  const workspace = await mkdtemp(join(tmpdir(), "agentshare-environment-"));
  try {
    await verifyTarget(target);
    const executable = resolveAgentExecutable(target);
    const cliPath = process.argv[1];
    if (cliPath === undefined) throw new Error("AgentShare CLI entrypoint is unavailable");
    const args = target === "codex"
      ? codexEnvironmentArgs(
          workspace,
          environmentId,
          process.execPath,
          cliPath,
          options,
          await discoverUserSkills(),
        )
      : claudeEnvironmentArgs(
          environmentId,
          process.execPath,
          cliPath,
          options,
        );
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
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const value = sanitizeTerminalText(chunk);
      output = `${output}${value}`.slice(-32_000);
      process.stdout.write(value);
    });
    child.stderr.on("data", (chunk: string) => {
      process.stderr.write(sanitizeTerminalText(chunk));
    });
    child.stdin.end(prompt);
    return { exitCode: await waitForTargetClose(child), output: output.trim() };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export function codexEnvironmentArgs(
  workspace: string,
  environmentId: string,
  nodeCommand: string,
  cliPath: string,
  options: { statePath?: string; cacheRoot?: string } = {},
  disabledSkills: string[] = [],
): string[] {
  const base = codexArgs(workspace, disabledSkills);
  const promptMarker = base.at(-1) === "-" ? base.slice(0, -1) : base;
  const mcpArgs = internalMcpArgs(environmentId, options);
  return [
    ...promptMarker,
    "--config",
    `mcp_servers.agentshare.command=${tomlString(nodeCommand)}`,
    "--config",
    `mcp_servers.agentshare.args=[${[cliPath, ...mcpArgs]
      .map(tomlString)
      .join(",")}]`,
    "--config",
    "mcp_servers.agentshare.startup_timeout_sec=15",
    "-",
  ];
}

export function claudeEnvironmentArgs(
  environmentId: string,
  nodeCommand: string,
  cliPath: string,
  options: { statePath?: string; cacheRoot?: string } = {},
): string[] {
  const args = [...claudeArgs()];
  const configIndex = args.indexOf("--mcp-config");
  if (configIndex === -1 || args[configIndex + 1] === undefined) {
    throw new Error("Claude AgentShare launcher is missing MCP configuration support");
  }
  args[configIndex + 1] = JSON.stringify({
    mcpServers: {
      agentshare: {
        command: nodeCommand,
        args: [cliPath, ...internalMcpArgs(environmentId, options)],
      },
    },
  });
  args.push(
    "--allowedTools",
    MCP_TOOLS.map((name) => `mcp__agentshare__${name}`).join(","),
  );
  return args;
}

function internalMcpArgs(
  environmentId: string,
  options: { statePath?: string; cacheRoot?: string },
): string[] {
  return [
    "internal-mcp",
    "--environment",
    environmentId,
    ...(options.statePath === undefined
      ? []
      : ["--state-path", options.statePath]),
    ...(options.cacheRoot === undefined
      ? []
      : ["--cache-root", options.cacheRoot]),
  ];
}

function tomlString(value: string): string {
  return JSON.stringify(value);
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
