import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { previewEnvironmentCapture } from "./publication.js";

describe("environment publication preview", () => {
  it("reports included files, exclusions, and redactions without contacting a relay", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-preview-"));
    await writeFile(join(root, "safe.txt"), "api_key=abcdefghijklmnop\n", "utf8");
    await writeFile(join(root, ".env"), "PASSWORD=secretsecretsecret\n", "utf8");
    const preview = await previewEnvironmentCapture(
      {
        sourceAgent: "codex",
        title: "Demo",
        workspaceRoot: root,
        conversation: [
          {
            sequence: 0,
            role: "user",
            kind: "message",
            text: "Share this project",
            sourceId: "thread",
          },
        ],
      },
      {
        includeConversation: true,
        includeWorkspace: true,
        proposalsEnabled: true,
        workspaceOptions: { preferGit: false },
      },
    );
    expect(preview.summary.files).toBe(1);
    expect(preview.summary.conversationEvents).toBe(1);
    expect(preview.summary.excludedFiles).toBeGreaterThanOrEqual(1);
    expect(preview.summary.redactions).toBe(1);
    expect(preview.includedPaths).toEqual(["safe.txt"]);
    expect(preview.excluded.some((item) => item.path === ".env")).toBe(true);
    expect(preview.findings[0]?.kind).toBe("generic-secret");
  });
});
