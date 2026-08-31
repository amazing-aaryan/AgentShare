import { createHash } from "node:crypto";
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
  it("classifies complete file bytes and preserves content exactly", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-encodings-"));
    const files = [
      {
        path: "settings.yaml",
        bytes: Buffer.from("\uFEFFname: café\r\n"),
        mediaType: "application/yaml",
      },
      {
        path: "settings.toml",
        bytes: Buffer.from('name = "demo"\r\n'),
        mediaType: "application/toml",
      },
      {
        path: "invalid.json",
        bytes: Buffer.from([0xff, 0xfe, 0x61]),
        mediaType: "application/octet-stream",
      },
      {
        path: "utf16.txt",
        bytes: Buffer.from("hello", "utf16le"),
        mediaType: "application/octet-stream",
      },
      {
        path: "late-nul",
        bytes: Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0])]),
        mediaType: "application/octet-stream",
      },
      {
        path: "late-invalid.ts",
        bytes: Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0xff])]),
        mediaType: "application/octet-stream",
      },
    ];
    for (const file of files)
      await writeFile(join(root, file.path), file.bytes);
    const snapshot = await buildWorkspaceSnapshot(root, { preferGit: false });
    for (const file of files) {
      expect(
        snapshot.files.find((entry) => entry.path === file.path),
      ).toMatchObject({
        mediaType: file.mediaType,
        byteLength: file.bytes.length,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
        contentBase64: file.bytes.toString("base64"),
      });
    }
  });

  it("rejects a credential in an operational filename without echoing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-path-secret-"));
    const secret = `sk-${"x".repeat(24)}`;
    await writeFile(join(root, `${secret}.txt`), "safe");
    await expect(
      buildWorkspaceSnapshot(root, { preferGit: false }),
    ).rejects.toThrow("[REDACTED:openai-api-key].txt");
    await expect(
      buildWorkspaceSnapshot(root, { preferGit: false }),
    ).rejects.not.toThrow(secret);
  });

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
