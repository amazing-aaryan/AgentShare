import { describe, expect, it } from "vitest";
import {
  claudeEnvironmentArgs,
  codexEnvironmentArgs,
} from "./environment-launcher.js";

const command = "/usr/bin/node";
const cli = "/opt/agentshare/dist/bin.js";

describe("environment worker launcher", () => {
  it("configures Codex with only the local AgentShare MCP on top of the hardened sandbox", () => {
    const args = codexEnvironmentArgs("/tmp/empty", "env_12345678901234567890", command, cli);
    expect(args).toContain("--ephemeral");
    expect(args.join(" ")).toContain("sandbox_mode=\"read-only\"");
    expect(args.join(" ")).toContain("mcp_servers.agentshare.command");
    expect(args.join(" ")).toContain("internal-mcp");
    expect(args.join(" ")).not.toContain("#r=");
    expect(args.join(" ")).not.toContain("environmentMasterKey");
  });

  it("configures Claude with no built-in tools and explicit AgentShare MCP tools", () => {
    const args = claudeEnvironmentArgs("env_12345678901234567890", command, cli);
    const toolsIndex = args.indexOf("--tools");
    expect(args[toolsIndex + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args.join(" ")).toContain("mcp__agentshare__read_file");
    expect(args.join(" ")).toContain("mcp__agentshare__proposal_submit");
    expect(args.join(" ")).not.toContain("#r=");
  });
});
