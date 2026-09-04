import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureProcess,
  claudeArgs,
  codexArgs,
  discoverUserSkills,
  resolveAgentExecutable,
  supportsReviewedEnvironmentTargetVersion,
  verifyTarget,
  waitForTargetClose,
  type TargetAgent,
  type TargetResult,
} from "../launchers.js";
import { sanitizeTerminalText } from "../terminal.js";
import { ensurePrivateDirectory } from "../environment/private-store.js";
import {
  environmentToolNames,
  hasRequiredCompletion,
  readMcpCompletions,
  type EnvironmentMode,
  type McpCompletionReceipt,
  type ReceiptChannel,
} from "./completion.js";

const WINDOWS_REVIEWED_CODEX_VERSION = "0.152.1";
const WINDOWS_REVIEWED_CODEX_MODEL = "gpt-5.6-sol";
const WINDOWS_MCP_ONLY_FEATURES = [
  "shell_tool",
  "unified_exec",
  "view_image",
  "shell_snapshot",
  "code_mode",
  "code_mode_host",
  "code_mode_only",
  "multi_agent",
  "multi_agent_v2",
  "image_generation",
  "skill_search",
  "plugins",
  "apps",
  "hooks",
  "memories",
] as const;

type CodexEnvironmentLaunchProfile = {
  platform?: NodeJS.Platform;
  modelCatalogPath?: string;
};

export type EnvironmentRuntimeOptions = {
  statePath?: string;
  cacheRoot?: string;
  mode?: EnvironmentMode;
  receiptChannel?: ReceiptChannel;
};
export type EnvironmentTargetResult = TargetResult & {
  receipts?: McpCompletionReceipt[];
};

export async function runEnvironmentTarget(
  target: TargetAgent,
  environmentId: string,
  prompt: string,
  options: EnvironmentRuntimeOptions = {},
): Promise<EnvironmentTargetResult> {
  const workspace = await mkdtemp(join(tmpdir(), "agentshare-environment-"));
  // A sibling directory is outside the denied recipient workspace. Only the
  // trusted MCP subprocess receives this channel, not the agent environment.
  const receiptDirectory = await mkdtemp(
    join(tmpdir(), "agentshare-receipts-"),
  );
  const mode = options.mode ?? "ask";
  const receiptChannel: ReceiptChannel = {
    path: join(receiptDirectory, "completed.jsonl"),
    runId: randomUUID(),
    environmentId,
    mode,
  };
  const runtimeOptions = { ...options, mode, receiptChannel };
  try {
    await ensurePrivateDirectory(receiptDirectory);
    await verifyTarget(target);
    const executable = resolveAgentExecutable(target);
    await verifyEnvironmentMcpSupport(target, executable, process.platform);
    const cliPath = process.argv[1];
    if (cliPath === undefined)
      throw new Error("AgentShare CLI entrypoint is unavailable");
    const modelCatalogPath =
      target === "codex" && process.platform === "win32"
        ? join(receiptDirectory, "codex-models.json")
        : undefined;
    if (modelCatalogPath !== undefined) {
      await writeFile(modelCatalogPath, windowsCodexModelCatalog(), {
        encoding: "utf8",
        mode: 0o600,
      });
    }
    const args =
      target === "codex"
        ? codexEnvironmentArgs(
            workspace,
            environmentId,
            process.execPath,
            cliPath,
            runtimeOptions,
            await discoverUserSkills(),
            { platform: process.platform, modelCatalogPath },
          )
        : claudeEnvironmentArgs(
            environmentId,
            process.execPath,
            cliPath,
            runtimeOptions,
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
    const workerStatus = { cancelledTool: false };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const value = sanitizeTerminalText(chunk);
      output = `${output}${value}`.slice(-32_000);
      process.stdout.write(value);
    });
    child.stderr.on("data", (chunk: string) => {
      if (/user cancelled MCP tool call/iu.test(chunk))
        workerStatus.cancelledTool = true;
      process.stderr.write(sanitizeTerminalText(chunk));
    });
    child.stdin.end(prompt);
    const processExitCode = await waitForTargetClose(child);
    const receipts = await readMcpCompletions(receiptChannel);
    const completed =
      !workerStatus.cancelledTool &&
      hasRequiredCompletion(receipts, mode, environmentId);
    if (!completed)
      process.stderr.write(
        `AgentShare ${mode} failed: no required completed MCP receipt.\n`,
      );
    return {
      exitCode: processExitCode !== 0 ? processExitCode : completed ? 0 : 1,
      output: output.trim(),
      receipts,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(receiptDirectory, { recursive: true, force: true });
  }
}

export function codexEnvironmentArgs(
  workspace: string,
  environmentId: string,
  nodeCommand: string,
  cliPath: string,
  options: EnvironmentRuntimeOptions = {},
  disabledSkills: string[] = [],
  profile: CodexEnvironmentLaunchProfile = {},
): string[] {
  const platform = profile.platform ?? process.platform;
  const base = codexArgs(workspace, disabledSkills);
  const promptMarker = base.at(-1) === "-" ? base.slice(0, -1) : base;
  const hardenedBase =
    platform === "win32"
      ? removeCodexConfig(
          promptMarker,
          "permissions.agentshare-query.filesystem=",
        )
      : promptMarker;
  const windowsOverrides =
    platform === "win32"
      ? windowsCodexEnvironmentOverrides(profile.modelCatalogPath)
      : [];
  const mcpArgs = internalMcpArgs(environmentId, options);
  return [
    ...hardenedBase,
    ...windowsOverrides,
    "--config",
    `mcp_servers.agentshare.command=${tomlString(nodeCommand)}`,
    "--config",
    `mcp_servers.agentshare.args=[${[cliPath, ...mcpArgs]
      .map(tomlString)
      .join(",")}]`,
    "--config",
    "mcp_servers.agentshare.startup_timeout_sec=15",
    "--config",
    "mcp_servers.agentshare.required=true",
    "--config",
    `mcp_servers.agentshare.enabled_tools=${JSON.stringify(environmentToolNames(options.mode ?? "ask"))}`,
    // Baseline schema reviewed against openai/codex rust-v0.147.0. Do not
    // change the global approval policy or server-wide default to make these
    // calls work on a newer release.
    ...environmentToolNames(options.mode ?? "ask").flatMap((name) => [
      "--config",
      `mcp_servers.agentshare.tools.${name}.approval_mode="approve"`,
    ]),
    ...Object.entries(internalMcpEnvironment(options)).flatMap(
      ([key, value]) => [
        "--config",
        `mcp_servers.agentshare.env.${key}=${tomlString(value)}`,
      ],
    ),
    "-",
  ];
}

export function windowsCodexModelCatalog(): string {
  return `${JSON.stringify({ models: [] })}\n`;
}

export function supportsReviewedWindowsEnvironmentTargetVersion(
  version: string,
): boolean {
  return new RegExp(
    `^codex-cli ${WINDOWS_REVIEWED_CODEX_VERSION.replaceAll(".", "\\.")}(?:\\s|$)`,
    "u",
  ).test(version.trim());
}

export function claudeEnvironmentArgs(
  environmentId: string,
  nodeCommand: string,
  cliPath: string,
  options: EnvironmentRuntimeOptions = {},
): string[] {
  const args = [...claudeArgs()];
  const configIndex = args.indexOf("--mcp-config");
  if (configIndex === -1 || args[configIndex + 1] === undefined) {
    throw new Error(
      "Claude AgentShare launcher is missing MCP configuration support",
    );
  }
  args[configIndex + 1] = JSON.stringify({
    mcpServers: {
      agentshare: {
        command: nodeCommand,
        args: [cliPath, ...internalMcpArgs(environmentId, options)],
        env: internalMcpEnvironment(options),
      },
    },
  });
  args.push(
    "--allowedTools",
    environmentToolNames(options.mode ?? "ask")
      .map((name) => `mcp__agentshare__${name}`)
      .join(","),
  );
  return args;
}

async function verifyEnvironmentMcpSupport(
  target: TargetAgent,
  executable: { command: string; prefixArgs: string[] },
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const version = await captureProcess(executable.command, [
    ...executable.prefixArgs,
    "--version",
  ]);
  if (!supportsReviewedEnvironmentTargetVersion(target, version)) {
    throw new Error(
      target === "codex"
        ? "codex has not passed AgentShare v2 MCP preflight; Codex v2 requires a recognizable Codex CLI >= 0.147.0 plus the required runtime isolation and MCP controls."
        : `${target} has not passed AgentShare v2 MCP review; install a reviewed ${target} version.`,
    );
  }
  if (
    target === "codex" &&
    platform === "win32" &&
    !supportsReviewedWindowsEnvironmentTargetVersion(version)
  ) {
    throw new Error(
      `Codex ${WINDOWS_REVIEWED_CODEX_VERSION} is the only Windows v2 recipient version reviewed for AgentShare's MCP-only isolation profile; refusing an unreviewed Windows Codex tool surface.`,
    );
  }
  if (target === "claude") {
    const help = await captureProcess(executable.command, [
      ...executable.prefixArgs,
      "--help",
    ]);
    for (const required of ["--mcp-config", "--allowedTools"]) {
      if (!help.includes(required)) {
        throw new Error(
          `claude no longer advertises required AgentShare MCP control ${required}; refusing to weaken isolation`,
        );
      }
    }
    return;
  }
  const help = await captureProcess(executable.command, [
    ...executable.prefixArgs,
    "mcp",
    "--help",
  ]);
  if (!/\bmcp\b/iu.test(help) && !/model context protocol/iu.test(help)) {
    throw new Error(
      "codex no longer advertises MCP client support; refusing to weaken AgentShare isolation",
    );
  }
}

function windowsCodexEnvironmentOverrides(
  modelCatalogPath: string | undefined,
): string[] {
  if (modelCatalogPath === undefined) {
    throw new Error(
      "Windows Codex recipient isolation requires a private AgentShare model catalog",
    );
  }
  return [
    "--config",
    `model=${tomlString(WINDOWS_REVIEWED_CODEX_MODEL)}`,
    "--config",
    `model_catalog_json=${tomlString(modelCatalogPath)}`,
    ...WINDOWS_MCP_ONLY_FEATURES.flatMap((feature) => [
      "--config",
      `features.${feature}=false`,
    ]),
  ];
}

function removeCodexConfig(args: string[], prefix: string): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (
      args[index] === "--config" &&
      args[index + 1]?.startsWith(prefix) === true
    ) {
      index += 1;
      continue;
    }
    const value = args[index];
    if (value !== undefined) filtered.push(value);
  }
  return filtered;
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

function internalMcpEnvironment(
  options: EnvironmentRuntimeOptions,
): Record<string, string> {
  return {
    AGENTSHARE_MCP_MODE: options.mode ?? "ask",
    ...(options.receiptChannel === undefined
      ? {}
      : {
          AGENTSHARE_MCP_RECEIPT_PATH: options.receiptChannel.path,
          AGENTSHARE_MCP_RUN_ID: options.receiptChannel.runId,
        }),
  };
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
