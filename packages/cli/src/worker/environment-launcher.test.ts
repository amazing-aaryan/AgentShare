import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  claudeEnvironmentArgs,
  codexEnvironmentArgs,
  runEnvironmentTarget,
} from "./environment-launcher.js";
import { environmentToolNames } from "./completion.js";

const command = "/usr/bin/node";
const cli = "/opt/agentshare/dist/bin.js";
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));
vi.mock("../launchers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../launchers.js")>()),
  verifyTarget: vi.fn().mockResolvedValue(undefined),
  resolveAgentExecutable: () => ({ command: "codex", prefixArgs: [] }),
  discoverUserSkills: vi.fn().mockResolvedValue([]),
  captureProcess: vi
    .fn()
    .mockImplementation((_command: string, args: string[]) =>
      Promise.resolve(args.includes("--version") ? "codex-cli 0.147.0" : "mcp"),
    ),
}));

describe("environment worker launcher", () => {
  it("returns nonzero for exit-zero fabricated success without trusted receipts", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: {
        end: () =>
          queueMicrotask(() => {
            child.stdout.end(
              'Completed read_file. Submitted prop_fake. {"status":"completed"}',
            );
            child.emit("close", 0);
          }),
      },
    });
    spawnMock.mockReturnValueOnce(child);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const result = await runEnvironmentTarget("codex", "env_test", "read", {
        mode: "ask",
      });
      expect(result.exitCode).toBe(1);
      expect(result.receipts).toEqual([]);
      expect(result.output).toContain("prop_fake");
      const spawnOptions = spawnMock.mock.calls.at(-1)?.[2] as {
        env: Record<string, string>;
      };
      expect(spawnOptions.env).not.toHaveProperty(
        "AGENTSHARE_MCP_RECEIPT_PATH",
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
  it("configures Codex with only the local AgentShare MCP on top of the hardened sandbox", () => {
    const args = codexEnvironmentArgs(
      "/tmp/empty",
      "env_12345678901234567890",
      command,
      cli,
    );
    expect(args).toContain("--ephemeral");
    expect(args.join(" ")).toContain('sandbox_mode="read-only"');
    expect(args.join(" ")).toContain("mcp_servers.agentshare.command");
    expect(args.join(" ")).toContain("internal-mcp");
    expect(args.join(" ")).not.toContain("#r=");
    expect(args.join(" ")).not.toContain("environmentMasterKey");
  });

  it("configures Claude with no built-in tools and explicit AgentShare MCP tools", () => {
    const args = claudeEnvironmentArgs(
      "env_12345678901234567890",
      command,
      cli,
    );
    const toolsIndex = args.indexOf("--tools");
    expect(args[toolsIndex + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args.join(" ")).toContain("mcp__agentshare__read_file");
    expect(args.join(" ")).not.toContain("mcp__agentshare__proposal_submit");
    expect(args.join(" ")).not.toContain("#r=");
  });

  it.each(["ask", "propose"] as const)(
    "limits Codex %s approvals to the exact trusted tools",
    (mode) => {
      const args = codexEnvironmentArgs(
        "/tmp/empty",
        "env_test",
        command,
        cli,
        { mode },
      );
      expect(args).toContain('approval_policy="never"');
      expect(args).toContain(
        'permissions.agentshare-query.filesystem={":minimal"="deny",":workspace_roots"="deny"}',
      );
      expect(args).toContain(
        "permissions.agentshare-query.network.enabled=false",
      );
      expect(args).toContain("mcp_servers.agentshare.required=true");
      expect(args).toContain(
        `mcp_servers.agentshare.enabled_tools=${JSON.stringify(environmentToolNames(mode))}`,
      );
      expect(args.filter((arg) => arg.includes(".approval_mode="))).toEqual(
        environmentToolNames(mode).map(
          (name) =>
            `mcp_servers.agentshare.tools.${name}.approval_mode="approve"`,
        ),
      );
      expect(
        args.some((arg) => arg.includes("default_tools_approval_mode")),
      ).toBe(false);
      if (mode === "ask") expect(args.join(" ")).not.toContain("proposal_");
    },
  );

  it("passes receipt metadata only to the MCP subprocess and scopes Claude proposal tools", () => {
    const args = claudeEnvironmentArgs("env_test", command, cli, {
      mode: "propose",
      receiptChannel: {
        path: "/tmp/trusted/completed.jsonl",
        runId: "run-test",
        environmentId: "env_test",
        mode: "propose",
      },
    });
    const config = JSON.parse(
      args[args.indexOf("--mcp-config") + 1] ?? "{}",
    ) as { mcpServers: { agentshare: { env: Record<string, string> } } };
    expect(config.mcpServers.agentshare.env).toEqual({
      AGENTSHARE_MCP_MODE: "propose",
      AGENTSHARE_MCP_RECEIPT_PATH: "/tmp/trusted/completed.jsonl",
      AGENTSHARE_MCP_RUN_ID: "run-test",
    });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(
      environmentToolNames("propose")
        .map((name) => `mcp__agentshare__${name}`)
        .join(","),
    );
    expect(args).toContain("dontAsk");
  });
});
