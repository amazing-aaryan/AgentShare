import { describe, expect, it } from "vitest";
import {
  codexEnvironmentArgs,
  type EnvironmentRuntimeOptions,
} from "./environment-launcher.js";

const command = "/usr/bin/node";
const cli = "/opt/agentshare/dist/bin.js";

type WindowsCodexOptions = EnvironmentRuntimeOptions & {
  codexModelCatalogPath: string;
  codexSplitReadBoundary: boolean;
};

describe("Codex recipient capability isolation", () => {
  it("disables local image, permission-escalation, and multi-agent tools", () => {
    const args = codexEnvironmentArgs("/tmp/empty", "env_test", command, cli);

    expect(args).toContain("features.view_image=false");
    expect(args).toContain("features.request_permissions_tool=false");
    expect(args).toContain("agents.enabled=false");
  });

  it("uses tool-surface isolation on native Windows without the unsupported split-read ACL", () => {
    const catalog = String.raw`C:\Users\recipient\AppData\Local\Temp\agentshare\model-catalog.json`;
    const options: WindowsCodexOptions = {
      codexModelCatalogPath: catalog,
      codexSplitReadBoundary: false,
      mode: "ask",
    };
    const args = codexEnvironmentArgs(
      String.raw`C:\Temp\agentshare-environment`,
      "env_test",
      command,
      cli,
      options,
    );

    expect(args).toContain('sandbox_mode="read-only"');
    expect(args).not.toContain('default_permissions="agentshare-query"');
    expect(args).not.toContain(
      'permissions.agentshare-query.filesystem={":minimal"="deny",":workspace_roots"="deny"}',
    );
    expect(args).toContain(`model_catalog_json=${JSON.stringify(catalog)}`);
    expect(args).toContain("mcp_servers.agentshare.required=true");
    expect(args.some((arg) => arg.includes("mcp_servers.agentshare.enabled_tools="))).toBe(
      true,
    );
  });

  it("retains the stronger split-read boundary by default", () => {
    const args = codexEnvironmentArgs("/tmp/empty", "env_test", command, cli);

    expect(args).toContain('default_permissions="agentshare-query"');
    expect(args).toContain(
      'permissions.agentshare-query.filesystem={":minimal"="deny",":workspace_roots"="deny"}',
    );
    expect(args.some((arg) => arg.startsWith("model_catalog_json="))).toBe(
      false,
    );
  });
});
