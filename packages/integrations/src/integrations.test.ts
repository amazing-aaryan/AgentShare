import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installIntegrations, removeIntegrations } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
  }
});

describe("host integrations", () => {
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
    expect(codexCreatorSkill).toContain("interactive terminal");
    expect(claudeReceiver).toContain("/e/");
    expect(claudeReceiver).toContain("agentshare ask");
    expect(codexCreator).toContain("allow_implicit_invocation: false");
    expect(codexReceiver).toContain("allow_implicit_invocation: true");
    await removeIntegrations(roots);
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
