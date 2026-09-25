import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  enableCodexApprovalPromptsByDefault,
  installCreatorMcpConfiguration,
  hostSkillsCurrent,
  installHostSkills,
  installIntegrations,
  installReceiverIntegrations,
  removeIntegrations,
} from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
  }
});

describe("host integrations", () => {
  it("sets only the root Codex approval default after explicit consent", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-approval-default-"));
    directories.push(root);
    const path = join(root, "config.toml");
    const original =
      'approval_policy = "never" # prior default\n[profiles.quiet]\napproval_policy = "never"\n';
    await writeFile(path, original);
    await enableCodexApprovalPromptsByDefault(path);
    const changed = await readFile(path, "utf8");
    expect(changed).toBe(
      'approval_policy = "on-request" # prior default\n[profiles.quiet]\napproval_policy = "never"\n',
    );
    expect(await readFile(`${path}.agentshare-backup`, "utf8")).toBe(original);
    await enableCodexApprovalPromptsByDefault(path);
    expect(await readFile(path, "utf8")).toBe(changed);
  });

  it("inserts an absent default and refuses unsupported approval policies", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-approval-default-"));
    directories.push(root);
    const path = join(root, "config.toml");
    await writeFile(path, '[mcp_servers.other]\ncommand = "other-tool"\n');
    await enableCodexApprovalPromptsByDefault(path);
    expect(await readFile(path, "utf8")).toBe(
      'approval_policy = "on-request"\n[mcp_servers.other]\ncommand = "other-tool"\n',
    );
    const unsupported =
      "approval_policy = { granular = { mcp_elicitations = true } }\n";
    await writeFile(path, unsupported);
    await expect(enableCodexApprovalPromptsByDefault(path)).rejects.toThrow(
      "Unsupported Codex approval_policy",
    );
    expect(await readFile(path, "utf8")).toBe(unsupported);
    const duplicate =
      'approval_policy = "never"\napproval_policy = "on-request"\n';
    await writeFile(path, duplicate);
    await expect(enableCodexApprovalPromptsByDefault(path)).rejects.toThrow(
      "Duplicate Codex approval_policy",
    );
    expect(await readFile(path, "utf8")).toBe(duplicate);
    const quoted = `'approval_policy' = "never"\n`;
    await writeFile(path, quoted);
    await expect(enableCodexApprovalPromptsByDefault(path)).rejects.toThrow(
      "Unsupported Codex approval_policy",
    );
    expect(await readFile(path, "utf8")).toBe(quoted);
  });

  it("preserves unrelated MCP configuration and refuses unmanaged collisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-mcp-config-"));
    directories.push(root);
    const path = join(root, "config.toml");
    const original = '[mcp_servers.other]\ncommand = "other-tool"\n';
    await writeFile(path, original);
    await installCreatorMcpConfiguration(path, "node", "C:/AgentShare/bin.js");
    const installed = await readFile(path, "utf8");
    expect(installed).toContain(original);
    expect(installed).toContain('"creator-mcp"');
    await installCreatorMcpConfiguration(path, "node", "C:/AgentShare/bin.js");
    expect(await readFile(path, "utf8")).toBe(installed);
    expect(await readFile(`${path}.agentshare-backup`, "utf8")).toBe(original);
    await writeFile(
      path,
      '[mcp_servers.agentshare_creator]\ncommand="custom"\n',
    );
    await expect(installCreatorMcpConfiguration(path)).rejects.toThrow(
      "unmanaged",
    );
  });
  it("installs explicit creator skills and automatic direct-paste receiver skills idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-integration-"));
    directories.push(root);
    const roots = {
      codexSkills: join(root, "codex"),
      claudeSkills: join(root, "claude"),
    };
    await installIntegrations(roots);
    await installIntegrations(roots);
    const claudeCreator = await readFile(
      join(roots.claudeSkills, "share", "SKILL.md"),
      "utf8",
    );
    const claudeReceiver = await readFile(
      join(roots.claudeSkills, "agentshare", "SKILL.md"),
      "utf8",
    );
    const codexCreatorSkill = await readFile(
      join(roots.codexSkills, "agentshare", "SKILL.md"),
      "utf8",
    );
    const codexCreator = await readFile(
      join(roots.codexSkills, "agentshare", "agents", "openai.yaml"),
      "utf8",
    );
    const codexReceiver = await readFile(
      join(roots.codexSkills, "agentshare-receive", "agents", "openai.yaml"),
      "utf8",
    );
    expect(claudeCreator).toContain("disable-model-invocation: true");
    expect(claudeCreator).toContain("interactive terminal");
    expect(codexCreatorSkill).toContain("native form");
    expect(codexCreatorSkill).toContain("select_share_options");
    expect(codexCreatorSkill).toContain("arrow keys");
    expect(codexCreatorSkill).toContain("press Enter");
    expect(codexCreatorSkill).toContain("do not ask choices in chat");
    expect(codexCreatorSkill).toContain(
      "Do not open review pages unless the user asks",
    );
    expect(codexCreatorSkill).toContain("/permissions");
    expect(codexCreatorSkill).toContain("no `/approvals` command");
    expect(codexCreatorSkill).not.toContain("run `/approvals`");
    expect(codexCreatorSkill).toContain("On Request");
    expect(codexCreatorSkill).toContain("never launch the terminal fallback");
    expect(codexCreatorSkill).toContain("agentshare session-context");
    expect(claudeReceiver).toContain("/e/");
    expect(claudeReceiver).toContain("agentshare ask");
    expect(codexCreator).toContain("allow_implicit_invocation: false");
    expect(codexReceiver).toContain("allow_implicit_invocation: true");
    await removeIntegrations(roots);
  });

  it("installs receiver integrations without changing creator MCP config", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "agentshare-receiver-integration-"),
    );
    directories.push(root);
    const config = join(root, "codex", "config.toml");
    const original = '[mcp_servers.other]\ncommand = "other-tool"\n';
    await mkdir(join(root, "codex"), { recursive: true });
    await writeFile(config, original, "utf8");
    const roots = {
      codexConfig: config,
      codexSkills: join(root, "codex"),
      claudeSkills: join(root, "claude"),
    };

    await installReceiverIntegrations(roots);

    expect(await readFile(config, "utf8")).toBe(original);
    expect(
      await readFile(
        join(roots.codexSkills, "agentshare-receive", "SKILL.md"),
        "utf8",
      ),
    ).toContain("agentshare bootstrap");
    await expect(
      readFile(join(roots.codexSkills, "agentshare", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("installs host skills after MCP connection without changing its config", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-mcp-setup-"));
    directories.push(root);
    const config = join(root, "config.toml");
    const original = '[mcp_servers.agentshare_creator]\ncommand = "npm"\n';
    await writeFile(config, original);
    const roots = {
      codexConfig: config,
      codexSkills: join(root, "codex"),
      codexHomeSkills: join(root, "codex-home"),
      claudeSkills: join(root, "claude"),
    };
    expect(await hostSkillsCurrent(roots)).toBe(false);
    const files = await installHostSkills(roots);
    expect(files).toHaveLength(10);
    expect(await hostSkillsCurrent(roots)).toBe(true);
    expect(await readFile(config, "utf8")).toBe(original);
    expect(
      await readFile(join(roots.codexSkills, "agentshare", "SKILL.md"), "utf8"),
    ).toContain("select_share_options");
    expect(
      await readFile(
        join(roots.codexHomeSkills, "agentshare", "SKILL.md"),
        "utf8",
      ),
    ).toBe(
      await readFile(join(roots.codexSkills, "agentshare", "SKILL.md"), "utf8"),
    );
    expect(
      await readFile(
        join(roots.codexHomeSkills, "agentshare-receive", "SKILL.md"),
        "utf8",
      ),
    ).toBe(
      await readFile(
        join(roots.codexSkills, "agentshare-receive", "SKILL.md"),
        "utf8",
      ),
    );
    await removeIntegrations({
      codexSkills: roots.codexSkills,
      codexHomeSkills: roots.codexHomeSkills,
      claudeSkills: roots.claudeSkills,
    });
    await expect(
      readFile(join(roots.codexHomeSkills, "agentshare", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("refreshes older AgentShare-managed integration content", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-integration-"));
    directories.push(root);
    const roots = {
      codexSkills: join(root, "codex"),
      claudeSkills: join(root, "claude"),
    };
    await installIntegrations(roots);
    const path = join(roots.codexSkills, "agentshare", "SKILL.md");
    await writeFile(
      path,
      "<!-- managed-by: agentshare -->\nold content\n",
      "utf8",
    );

    await installIntegrations(roots);

    const refreshed = await readFile(path, "utf8");
    expect(refreshed).not.toContain("old content");
    expect(refreshed).toContain("agentshare share --current --source codex");
  });

  it("refuses to overwrite unmanaged skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-integration-"));
    directories.push(root);
    const roots = {
      codexSkills: join(root, "codex"),
      claudeSkills: join(root, "claude"),
    };
    const path = join(roots.claudeSkills, "share", "SKILL.md");
    await writeFile(path, "unmanaged", { encoding: "utf8", flag: "wx" }).catch(
      async () => {
        await import("node:fs/promises").then(({ mkdir }) =>
          mkdir(join(roots.claudeSkills, "share"), { recursive: true }),
        );
        await writeFile(path, "unmanaged", "utf8");
      },
    );
    await expect(installIntegrations(roots)).rejects.toThrow("unmanaged");
  });
});
