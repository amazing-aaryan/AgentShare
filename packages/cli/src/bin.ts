#!/usr/bin/env node
import { openCommand, revokeCommand, shareCommand } from "./commands.js";
import {
  installIntegrations,
  removeIntegrations,
} from "@agentshare/integrations";

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "share") {
    const current = args.includes("--current");
    const inputPath = current ? undefined : positional(args, 0);
    const url = await shareCommand({
      ...(inputPath === undefined ? {} : { inputPath }),
      current,
      relayOrigin:
        option(args, "--relay") ??
        process.env.AGENTSHARE_RELAY ??
        "http://127.0.0.1:8787",
      ttlSeconds: Number(option(args, "--ttl") ?? "3600"),
      sourceAgent: sourceAgent(option(args, "--source") ?? "generic"),
      yes: args.includes("--yes"),
      forceNew: args.includes("--new"),
    });
    process.stdout.write(`${url}\n`);
  } else if (command === "open") {
    await openCommand(targetAgent(option(args, "--target") ?? "codex"));
  } else if (command === "revoke") {
    await revokeCommand();
    process.stdout.write("Share revoked\n");
  } else if (command === "init" || command === "repair") {
    const files = await installIntegrations();
    process.stdout.write(`Installed integrations:\n${files.join("\n")}\n`);
  } else if (command === "remove") {
    await removeIntegrations();
    process.stdout.write("AgentShare integrations removed\n");
  } else {
    usage();
    process.exitCode = command === undefined ? 0 : 1;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
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
  process.stdout.write(`  agentshare init|repair|remove\n`);
}
