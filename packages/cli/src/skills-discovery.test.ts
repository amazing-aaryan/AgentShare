import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverUserSkills } from "./launchers.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("recipient skill isolation discovery", () => {
  it("includes the configured provider home without losing normal user roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-skills-"));
    roots.push(root);
    const home = join(root, "user");
    const configured = join(root, "custom-codex");
    const files = [
      join(home, ".agents", "skills", "shared", "SKILL.md"),
      join(home, ".codex", "skills", "legacy", "SKILL.md"),
      join(configured, "skills", "configured", "SKILL.md"),
    ];
    for (const path of files) {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "synthetic instructions", "utf8");
    }
    expect(await discoverUserSkills(home, configured)).toEqual(
      files.sort((a, b) => a.localeCompare(b, "en")),
    );
    expect(await discoverUserSkills(home)).toHaveLength(2);
    expect(await discoverUserSkills(home, join(home, ".codex"))).toHaveLength(
      2,
    );
  });
});
