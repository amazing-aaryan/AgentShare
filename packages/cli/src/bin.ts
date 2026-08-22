#!/usr/bin/env node
import { MAX_TTL_SECONDS } from "@agentshare/contracts";
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
        process.stdout.write(
          `AgentShare v${result.currentVersion} is up to date.\n`,
        );
      }
    } else {
      const result = await updateAgentShare();
      if (result.status === "updated") {
        process.stdout.write(
          `AgentShare updated from v${result.fromVersion} to v${result.toVersion}. Integrations repaired.\n`,
        );
      } else {
        process.stdout.write(
          `AgentShare v${result.currentVersion} is up to date.\n`,
        );
      }
    }
  } else if (command === "share") {
    assertKnownOptions(
      args,
      new Set([
        "--current",
        "--relay",
        "--handoff",
        "--ttl",
        "--source",
        "--new",
        "--legacy",
      ]),
    );
    const current = args.includes("--current");
    const selectedSource = sourceAgent(option(args, "--source") ?? "generic");
    const ttlSeconds = optionalTtlSeconds(args);
    if (
      current &&
      (selectedSource === "codex" || selectedSource === "claude") &&
      !args.includes("--legacy")
    ) {
      const relayOrigin = option(args, "--relay") ?? process.env.AGENTSHARE_RELAY;
      const handoffOrigin =
        option(args, "--handoff") ??
        process.env.AGENTSHARE_HANDOFF ??
        TRUSTED_HANDOFF_ORIGIN;
      const result = await shareCurrentV2(selectedSource, {
        ...(relayOrigin === undefined ? {} : { relayOrigin }),
        handoffOrigin,
        forceNew: args.includes("--new"),
        ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
      });
      process.stdout.write(`${result.url}\n`);
    } else {
      const inputPath = current ? undefined : positional(args, 0);
      process.stdout.write(
        `${await legacyShare(args, current, inputPath, selectedSource, ttlSeconds)}\n`,
      );
    }
  } else if (command === "share-v1") {
    assertKnownOptions(
      args,
      new Set([
        "--current",
        "--relay",
        "--handoff",
        "--ttl",
        "--source",
        "--new",
      ]),
    );
    const current = args.includes("--current");
    const inputPath = current ? undefined : positional(args, 0);
    process.stdout.write(
      `${await legacyShare(
        args,
        current,
        inputPath,
        sourceAgent(option(args, "--source") ?? "generic"),
        optionalTtlSeconds(args),
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

async function legacyShare(
  args: string[],
  current: boolean,
  inputPath: string | undefined,
  selectedSource: "codex" | "claude" | "generic",
  ttlSeconds: number | undefined,
): Promise<string> {
  return shareCommand({
    ...(inputPath === undefined ? {} : { inputPath }),
    current,
    relayOrigin:
      option(args, "--relay") ??
      process.env.AGENTSHARE_RELAY ??
      DEFAULT_RELAY_ORIGIN,
    handoffOrigin:
      option(args, "--handoff") ??
      process.env.AGENTSHARE_HANDOFF ??
      TRUSTED_HANDOFF_ORIGIN,
    ttlSeconds: ttlSeconds ?? 3600,
    sourceAgent: selectedSource,
    forceNew: args.includes("--new"),
  });
}

function optionalTtlSeconds(args: string[]): number | undefined {
  const raw = option(args, "--ttl");
  if (raw === undefined) return undefined;
  if (!/^\d+$/u.test(raw)) {
    throw new Error(
      `--ttl must be an integer between 1 and ${MAX_TTL_SECONDS} seconds`,
    );
  }
  const ttlSeconds = Number(raw);
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw new Error(
      `--ttl must be an integer between 1 and ${MAX_TTL_SECONDS} seconds`,
    );
  }
  return ttlSeconds;
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

function shouldRunPassiveUpdateCheck(command: string | undefined): boolean {
  return (
    command === "share" ||
    command === "share-v1" ||
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
  throw new Error("target/source must be codex or claude");
}

function usage(): void {
  process.stdout.write(`AgentShare\n\n`);
  process.stdout.write(
    `  agentshare share --current --source codex|claude [--new] [--ttl SECONDS] [--relay URL] [--handoff URL]\n`,
  );
  process.stdout.write(`  agentshare bootstrap < link-on-stdin\n`);
  process.stdout.write(
    `  agentshare ask [--environment ID] --target codex|claude --question TEXT\n`,
  );
  process.stdout.write(
    `  agentshare propose [--environment ID] --target codex|claude --instruction TEXT\n`,
  );
  process.stdout.write(`  agentshare inbox --source codex|claude\n`);
  process.stdout.write(`  agentshare revoke-environment --environment ID\n`);
  process.stdout.write(
    `  agentshare share-v1 <file>|--current [--new] [--ttl SECONDS] [--relay URL] [--handoff URL]\n`,
  );
  process.stdout.write(`  agentshare open --target codex|claude\n`);
  process.stdout.write(`  agentshare revoke\n`);
  process.stdout.write(`  agentshare update --check\n`);
  process.stdout.write(`  agentshare update\n`);
  process.stdout.write(`  agentshare init|repair|remove\n`);
  process.stdout.write(`  agentshare --version\n`);
}
