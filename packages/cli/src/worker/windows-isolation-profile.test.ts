import { describe, expect, it } from "vitest";
import { codexEnvironmentArgs } from "./environment-launcher.js";

const command = "/usr/bin/node";
const cli = "/opt/agentshare/dist/bin.js";

describe("Codex recipient capability isolation", () => {
  it("disables local image, permission-escalation, and multi-agent tools", () => {
    const args = codexEnvironmentArgs("/tmp/empty", "env_test", command, cli);

    expect(args).toContain("features.view_image=false");
    expect(args).toContain("features.request_permissions_tool=false");
    expect(args).toContain("agents.enabled=false");
  });
});
