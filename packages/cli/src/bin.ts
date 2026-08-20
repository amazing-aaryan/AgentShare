#!/usr/bin/env node
import { openCommand, revokeCommand, shareCommand } from "./commands.js";
import {
  installIntegrations,
  removeIntegrations,
} from "@agentshare/integrations";
import { sanitizeTerminalText } from "./terminal.js";
import {
  checkForUpdate,
  passiveUpdateNotice,
  updateAgentShare,
} from "./update.js";
import { AGENTSHARE_VERSION } from "./version.js";

const DEFAULT_RELAY_ORIGIN =
  "https://agentshare-relay.carnation-vermicelli.workers.dev";
const TRUSTED_HANDOFF_ORIGIN =
  "https://agentshare-handoff.carnation-vermicelli.workers.dev";

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "--version") {
    assertKnownOptions(args, new Set());
    process.stdout.write(`${AGENTSHARE_VERSION}\n`);
  } else if (command === "update") {
    assertKnownOptions(args, new Set(["--check"]));
    if (args.includes("--check")) {
      const result = await checkForUpdate({ force: true });
      if (result.status === "available") {
        process.stdout.write(
          `AgentShare v${result.latestVersion} is available (installed v${result.currentVersion}).\nRun \`agentshare update\` to install it.\n`,
        );
      } else {
        process.stdout.write(`AgentShare v${result.currentVersion} is up to date.\n`);
      }
    } else {
      const result = await updateAgentShare();
      if (result.status === "updated") {
        process.stdout.write(
          `AgentShare updated from v${result.fromVersion} to v${result.toVersion}. Integrations repaired.\n`,
        );
      } else {
        process.stdout.write(`AgentShare v${result.currentVersion} is up to date.\n`);
      }
    }
  } else if (command === "share") {
    assertKnownOptions(
      args,
      new Set(["--current", "--relay", "--ttl", "--source", "--new"]),
    );
    const current = args.includes("--current");
    const inputPath = current ? undefined : positional(args, 0);
    const url = await shareCommand({
      ...(inputPath === undefined ? {} : { inputPath }),
      current,
      relayOrigin:
        option(args, "--relay") ??
        process.env.AGENTSHARE_RELAY ??
        DEFAULT_RELAY_ORIGIN,
      handoffOrigin: TRUSTED_HANDOFF_ORIGIN,
      ttlSeconds: Number(option(args, "--ttl") ?? "3600"),
      sourceAgent: sourceAgent(option(args, "--source") ?? "generic"),
      forceNew: args.includes("--new"),
    });
    process.stdout.write(`${url}\n`);
  } else if (command === "open") {
    assertKnownOptions(args, new Set(["--target"]));
    await openCommand(targetAgent(option(args, "--target") ?? "codex"));
  } else if (command === "revoke") {
    assertKnownOptions(args, new Set());
    await revokeCommand();
    process.stdout.write("Share revoked\n");
  } else if (command === "init" || command === "repair") {
    assertKnownOptions(args, new Set());
    const files = await installIntegrations();
    process.stdout.write(
      sanitizeTerminalText(`Installed integrations:\n${files.join("\n")}\n`),
    );
  } else if (command === "remove") {
    assertKnownOptions(args, new Set());
    await removeIntegrations();
    process.stdout.write("AgentShare integrations removed\n");
  } else {
    usage();
    process.exitCode = command === undefined ? 0 : 1;
  }

  if (shouldRunPassiveUpdateCheck(command)) {
    const notice = await passiveUpdateNotice();
    if (notice !== undefined) {
      process.stderr.write(sanitizeTerminalText(`${notice}\n`));
    }
  }
} catch (error) {
  process.stderr.write(
    sanitizeTerminalText(
      `${error instanceof Error ? error.message : String(error)}\n`,
    ),
  );
  process.exitCode = 1;
}

function shouldRunPassiveUpdateCheck(command: string | undefined): boolean {
  return (
    command === "share" ||
    command === "open" ||
    command === "revoke" ||
    command === "init" ||
    command === "repair"
  );
}

function assertKnownOptions(
  args: string[],
  allowed: ReadonlySet<string>,
): void {
  for (const value of args) {
    if (value.startsWith("--") && !allowed.has(value)) {
      throw new Error(`Unknown option: ${value}`);
    }
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function positional(args: string[], position: number): string {
  const values = args.filter(
    (value, index) =>
      !value.startsWith("--") && !args[index - 1]?.startsWith("--"),
  );
  const value = values[position];
  if (value === undefined) throw new Error("Missing input file");
  return value;
}

function sourceAgent(value: string): "codex" | "claude" | "generic" {
  if (value === "codex" || value === "claude" || value === "generic")
    return value;
  throw new Error("--source must be codex, claude, or generic");
}

function targetAgent(value: string): "codex" | "claude" {
  if (value === "codex" || value === "claude") return value;
  throw new Error("--target must be codex or claude");
}

function usage(): void {
  process.stdout.write(`AgentShare\n\n`);
  process.stdout.write(
    `  agentshare share <file> [--source codex|claude|generic] [--relay URL] [--ttl seconds] [--new]\n`,
  );
  process.stdout.write(
    `  agentshare share --current --source codex|claude [--relay URL] [--ttl seconds]\n`,
  );
  process.stdout.write(`  agentshare open --target codex|claude\n`);
  process.stdout.write(`  agentshare revoke\n`);
  process.stdout.write(`  agentshare update --check\n`);
  process.stdout.write(`  agentshare update\n`);
  process.stdout.write(`  agentshare init|repair|remove\n`);
  process.stdout.write(`  agentshare --version\n`);
}
