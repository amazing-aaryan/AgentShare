import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import { shareCaptureV2 } from "./share-v2.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentshare-share-v2-"));
  await writeFile(join(root, "README.md"), "first revision\n", "utf8");
  return root;
}

describe("v2 share command", () => {
  it("creates a 24-hour read-plus-propose environment without free-form input", async () => {
    const root = await fixture();
    const statePath = join(root, "state-v2.json");
    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetchImpl: typeof fetch = (input, init) => handler(new Request(input, init));
    const client = new EnvironmentRelayClient("http://127.0.0.1:8787", fetchImpl);
    const result = await shareCaptureV2(
      {
        sourceAgent: "codex",
        title: "Codex: demo",
        workspaceRoot: root,
        conversation: [
          { sequence: 0, role: "user", kind: "message", text: "Question", sourceId: "thread" },
        ],
      },
      {
        client,
        statePath,
        selection: {
          includeConversation: true,
          includeWorkspace: true,
          proposalsEnabled: true,
          ttlSeconds: 86400,
        },
        workspaceOptions: { preferGit: false },
      },
    );
    expect(result.url).toContain("/e/");
    expect(result.summary.files).toBe(1);
    expect(result.environment.sharePolicy.proposalsEnabled).toBe(true);
  });

  it("updates an existing environment and keeps the same capability URL", async () => {
    const root = await fixture();
    const statePath = join(root, "state-v2.json");
    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetchImpl: typeof fetch = (input, init) => handler(new Request(input, init));
    const client = new EnvironmentRelayClient("http://127.0.0.1:8787", fetchImpl);
    const capture = {
      sourceAgent: "codex" as const,
      title: "Codex: demo",
      workspaceRoot: root,
      conversation: [
        { sequence: 0, role: "user" as const, kind: "message" as const, text: "Question", sourceId: "thread" },
      ],
    };
    const first = await shareCaptureV2(capture, {
      client,
      statePath,
      selection: { includeConversation: true, includeWorkspace: true, proposalsEnabled: true, ttlSeconds: 86400 },
      workspaceOptions: { preferGit: false },
    });
    await writeFile(join(root, "README.md"), "second revision\n", "utf8");
    const second = await shareCaptureV2(capture, {
      client,
      statePath,
      existingEnvironmentId: first.environment.environmentId,
      workspaceOptions: { preferGit: false },
    });
    expect(second.url).toBe(first.url);
    expect(second.environment.currentRevisionId).not.toBe(first.environment.currentRevisionId);
  });
});
