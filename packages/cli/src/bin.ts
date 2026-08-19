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

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "share") {
    const current = args.includes("--current");
    const selectedSource = sourceAgent(option(args, "--source") ?? "generic");
    if (
      current &&
      (selectedSource === "codex" || selectedSource === "claude") &&
      !args.includes("--legacy")
    ) {
      const result = await shareCurrentV2(selectedSource, {
        ...(option(args, "--relay") === undefined
          ? {}
          : { relayOrigin: option(args, "--relay") }),
      });
      process.stdout.write(`${result.url}\n`);
    } else {
      const inputPath = current ? undefined : positional(args, 0);
      process.stdout.write(
        `${await legacyShare(args, current, inputPath, selectedSource)}\n`,
      );
    }
  } else if (command === "share-v1") {
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
    const result = await bootstrapEnvironment({
      ...(option(args, "--state-path") === undefined
        ? {}
        : { statePath: option(args, "--state-path") }),
      ...(option(args, "--cache-root") === undefined
        ? {}
        : { cacheRoot: option(args, "--cache-root") }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === "ask") {
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
      ...(option(args, "--state-path") === undefined
        ? {}
        : { statePath: option(args, "--state-path") }),
      ...(option(args, "--cache-root") === undefined
        ? {}
        : { cacheRoot: option(args, "--cache-root") }),
    });
    process.stdout.write(`${answer}\n`);
  } else if (command === "propose") {
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
        ...(option(args, "--state-path") === undefined
          ? {}
          : { statePath: option(args, "--state-path") }),
        ...(option(args, "--cache-root") === undefined
          ? {}
          : { cacheRoot: option(args, "--cache-root") }),
      },
    );
    process.stdout.write(`${result}\n`);
  } else if (command === "inbox") {
    await reviewProposalInbox(
      targetAgent(option(args, "--source") ?? "codex"),
      option(args, "--state-path"),
    );
  } else if (command === "internal-mcp") {
    const environmentId = option(args, "--environment");
    if (environmentId === undefined) throw new Error("Missing --environment");
    await runInternalMcpServer(environmentId, {
      ...(option(args, "--state-path") === undefined
        ? {}
        : { statePath: option(args, "--state-path") }),
      ...(option(args, "--cache-root") === undefined
        ? {}
        : { cacheRoot: option(args, "--cache-root") }),
    });
  } else if (command === "revoke-environment") {
    const environmentId = option(args, "--environment");
    if (environmentId === undefined) throw new Error("Missing --environment");
    await revokeOwnedEnvironment(environmentId, option(args, "--state-path"));
    process.stdout.write("Environment revoked\n");
  } else if (command === "open") {
    await openCommand(targetAgent(option(args, "--target") ?? "codex"));
  } else if (command === "revoke") {
    await revokeCommand();
    process.stdout.write("Share revoked\n");
  } else if (command === "init" || command === "repair") {
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
      "https://agentshare-relay.carnation-vermicelli.workers.dev",
    ttlSeconds: Number(option(args, "--ttl") ?? "3600"),
    sourceAgent: selectedSource,
    yes: args.includes("--yes"),
    forceNew: args.includes("--new"),
  });
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
