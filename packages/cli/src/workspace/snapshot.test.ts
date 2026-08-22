import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkspaceSnapshot } from "./snapshot.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentshare-workspace-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, "src", "index.ts"), "export const answer = 42;\n");
  await writeFile(join(root, "README.md"), "# Demo\n");
  await writeFile(join(root, ".env"), "SECRET=should-not-share\n");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored\n");
  await writeFile(join(root, ".git", "config"), "ignored\n");
  try {
    await symlink(join(root, ".env"), join(root, "src", "secret-link"));
  } catch {
    // Windows CI may not grant symlink privileges.
  }
  return root;
}

describe("buildWorkspaceSnapshot", () => {
  it("includes safe regular files with normalized paths and hashes", async () => {
    const root = await fixture();
    const snapshot = await buildWorkspaceSnapshot(root, { preferGit: false });
    expect(snapshot.files.map((file) => file.path).sort()).toEqual([
      "README.md",
      "src/index.ts",
    ]);
    expect(
      snapshot.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)),
    ).toBe(true);
    expect(snapshot.files.every((file) => !file.path.includes("\\"))).toBe(
      true,
    );
  });

  it("never includes AgentShare, git, dependencies, credentials, or symlinks", async () => {
    const root = await fixture();
    const snapshot = await buildWorkspaceSnapshot(root, { preferGit: false });
    expect(
      snapshot.files.some((file) =>
        /(?:\.git|\.agentshare|node_modules|\.env|secret-link)/u.test(
          file.path,
        ),
      ),
    ).toBe(false);
    expect(
      snapshot.excluded.some((entry) => entry.reason === "credential-policy"),
    ).toBe(true);
  });
});
