#!/usr/bin/env node
import { openCommand, revokeCommand, shareCommand } from "./commands.js";
import {
  installIntegrations,
  removeIntegrations,
} from "@agentshare/integrations";
import { askAttachedEnvironment } from "./commands/ask-v2.js";
import { bootstrapEnvironment } from "./commands/bootstrap-v2.js";
import { reviewProposalInbox } from "./commands/inbox-v2.js";
import { proposeAttachedEnvironmentChange } from "./commands/propose-v2.js";
import {
  latestAttachedEnvironment,
  repairOwnedEnvironmentPublications,
  revokeOwnedEnvironment,
} from "./commands/runtime-v2.js";
import { shareCurrentV2 } from "./commands/share-v2.js";
import { runInternalMcpServer } from "./worker/internal-mcp.js";
import { sanitizeTerminalText } from "./terminal.js";

const DEFAULT_RELAY_ORIGIN =
  "https://agentshare-relay.carnation-vermicelli.workers.dev";
const TRUSTED_HANDOFF_ORIGIN =
  "https://agentshare-handoff.carnation-vermicelli.workers.dev";

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "share") {
    assertKnownOptions(
      args,
      new Set([
        "--current",
        "--relay",
        "--ttl",
        "--source",
        "--new",
        "--legacy",
      ]),
    );
    const current = args.includes("--current");
    const selectedSource = sourceAgent(option(args, "--source") ?? "generic");
    if (
      current &&
      (selectedSource === "codex" || selectedSource === "claude") &&
      !args.includes("--legacy")
    ) {
      const relayOrigin = option(args, "--relay");
      const result = await shareCurrentV2(selectedSource, {
        ...(relayOrigin === undefined ? {} : { relayOrigin }),
      });
      process.stdout.write(`${result.url}\n`);
    } else {
      const inputPath = current ? undefined : positional(args, 0);
      process.stdout.write(
        `${await legacyShare(args, current, inputPath, selectedSource)}\n`,
      );
    }
  } else if (command === "share-v1") {
    assertKnownOptions(
      args,
      new Set(["--current", "--relay", "--ttl", "--source", "--new"]),
    );
    const current = args.includes("--current");
    const inputPath = current ? undefined : positional(args, 0);
    process.stdout.write(
      `${await legacyShare(
        args,
        current,
        inputPath,
        sourceAgent(option(args, "--source") ?? "generic"),
      )}\n`,
    );
  } else if (command === "bootstrap" || command === "accept") {
    assertKnownOptions(args, new Set(["--state-path", "--cache-root"]));
    const result = await bootstrapEnvironment(v2StorageOptions(args));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === "ask") {
    assertKnownOptions(
      args,
      new Set([
        "--environment",
        "--target",
        "--question",
        "--state-path",
        "--cache-root",
      ]),
    );
    const attached =
      option(args, "--environment") === undefined
        ? await latestAttachedEnvironment(option(args, "--state-path"))
        : undefined;
    const environmentId =
      option(args, "--environment") ?? attached?.environmentId;
    if (environmentId === undefined) throw new Error("Missing environment");
    const question = option(args, "--question");
    if (question === undefined) throw new Error("Missing --question");
    const answer = await askAttachedEnvironment(environmentId, question, {
      target: targetAgent(option(args, "--target") ?? "codex"),
      ...v2StorageOptions(args),
    });
    process.stdout.write(`${answer}\n`);
  } else if (command === "propose") {
    assertKnownOptions(
      args,
      new Set([
        "--environment",
        "--target",
        "--instruction",
        "--state-path",
        "--cache-root",
      ]),
    );
    const attached =
      option(args, "--environment") === undefined
        ? await latestAttachedEnvironment(option(args, "--state-path"))
        : undefined;
    const environmentId =
      option(args, "--environment") ?? attached?.environmentId;
    if (environmentId === undefined) throw new Error("Missing environment");
    const instruction = option(args, "--instruction");
    if (instruction === undefined) throw new Error("Missing --instruction");
    const result = await proposeAttachedEnvironmentChange(
      environmentId,
      instruction,
      {
        target: targetAgent(option(args, "--target") ?? "codex"),
        ...v2StorageOptions(args),
      },
    );
    process.stdout.write(`${result}\n`);
  } else if (command === "inbox") {
    assertKnownOptions(args, new Set(["--source", "--state-path"]));
    await reviewProposalInbox(
      targetAgent(option(args, "--source") ?? "codex"),
      option(args, "--state-path"),
    );
  } else if (command === "internal-mcp") {
    assertKnownOptions(
      args,
      new Set(["--environment", "--state-path", "--cache-root"]),
    );
    const environmentId = option(args, "--environment");
    if (environmentId === undefined) throw new Error("Missing --environment");
    await runInternalMcpServer(environmentId, v2StorageOptions(args));
  } else if (command === "revoke-environment") {
    assertKnownOptions(args, new Set(["--environment", "--state-path"]));
    const environmentId = option(args, "--environment");
    if (environmentId === undefined) throw new Error("Missing --environment");
    await revokeOwnedEnvironment(environmentId, option(args, "--state-path"));
    process.stdout.write("Environment revoked\n");
  } else if (command === "open") {
    assertKnownOptions(args, new Set(["--target"]));
    await openCommand(targetAgent(option(args, "--target") ?? "codex"));
  } else if (command === "revoke") {
    assertKnownOptions(args, new Set());
    await revokeCommand();
    process.stdout.write("Share revoked\n");
  } else if (command === "init" || command === "repair") {
    assertKnownOptions(args, new Set(["--state-path"]));
    const files = await installIntegrations();
    const repaired =
      command === "repair"
        ? await repairOwnedEnvironmentPublications(option(args, "--state-path"))
        : 0;
    process.stdout.write(
      sanitizeTerminalText(
        `Installed integrations:\n${files.join("\n")}\n${repaired > 0 ? `Resumed ${repaired} pending environment publication(s).\n` : ""}`,
      ),
    );
  } else if (command === "remove") {
    assertKnownOptions(args, new Set());
    await removeIntegrations();
    process.stdout.write("AgentShare integrations removed\n");
  } else {
    usage();
    process.exitCode = command === undefined ? 0 : 1;
  }
} catch (error) {
  process.stderr.write(
    sanitizeTerminalText(
      `${error instanceof Error ? error.message : String(error)}\n`,
    ),
  );
  process.exitCode = 1;
}

async function legacyShare(
  args: string[],
  current: boolean,
  inputPath: string | undefined,
  selectedSource: "codex" | "claude" | "generic",
): Promise<string> {
  return shareCommand({
    ...(inputPath === undefined ? {} : { inputPath }),
    current,
    relayOrigin:
      option(args, "--relay") ??
      process.env.AGENTSHARE_RELAY ??
      DEFAULT_RELAY_ORIGIN,
    handoffOrigin: TRUSTED_HANDOFF_ORIGIN,
    ttlSeconds: Number(option(args, "--ttl") ?? "3600"),
    sourceAgent: selectedSource,
    forceNew: args.includes("--new"),
  });
}

function v2StorageOptions(args: string[]): {
  statePath?: string;
  cacheRoot?: string;
} {
  const statePath = option(args, "--state-path");
  const cacheRoot = option(args, "--cache-root");
  return {
    ...(statePath === undefined ? {} : { statePath }),
    ...(cacheRoot === undefined ? {} : { cacheRoot }),
  };
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
  throw new Error("target/source must be codex or claude");
}

function usage(): void {
  process.stdout.write(`AgentShare\n\n`);
  process.stdout.write(`  agentshare share --current --source codex|claude\n`);
  process.stdout.write(`  agentshare bootstrap < link-on-stdin\n`);
  process.stdout.write(
    `  agentshare ask [--environment ID] --target codex|claude --question TEXT\n`,
  );
  process.stdout.write(
    `  agentshare propose [--environment ID] --target codex|claude --instruction TEXT\n`,
  );
  process.stdout.write(`  agentshare inbox --source codex|claude\n`);
  process.stdout.write(`  agentshare revoke-environment --environment ID\n`);
  process.stdout.write(`  agentshare share-v1 <file>|--current ...\n`);
  process.stdout.write(`  agentshare open --target codex|claude\n`);
  process.stdout.write(`  agentshare revoke\n`);
  process.stdout.write(`  agentshare init|repair|remove\n`);
}
