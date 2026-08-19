import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvironmentUrl } from "@agentshare/acb";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "./relay-client.js";
import { createEnvironmentFromCapture } from "./publication.js";
import { findOwnedEnvironment } from "./state.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentshare-publication-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "index.ts"), "export const answer = 42;\n");
  return root;
}

describe("creator environment publication", () => {
  it("publishes conversation plus workspace as an encrypted committed revision", async () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const handler = createRelayHandler(new InMemoryRelayStore(), {
      now: () => now,
    });
    const fetchImpl: typeof fetch = (input, init) =>
      handler(new Request(input, init));
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );
    const stateDir = await mkdtemp(
      join(tmpdir(), "agentshare-publication-state-"),
    );
    const statePath = join(stateDir, "state-v2.json");
    const root = await fixture();

    const result = await createEnvironmentFromCapture(
      {
        sourceAgent: "codex",
        title: "Codex: demo",
        workspaceRoot: root,
        conversation: [
          {
            sequence: 0,
            role: "user",
            kind: "message",
            text: "Why?",
            sourceId: "thread",
          },
          {
            sequence: 1,
            role: "assistant",
            kind: "message",
            text: "Because.",
            sourceId: "thread",
          },
        ],
      },
      {
        client,
        statePath,
        ttlSeconds: 86400,
        proposalsEnabled: true,
        includeConversation: true,
        includeWorkspace: true,
        now: () => now,
        workspaceOptions: { preferGit: false },
      },
    );

    const parsed = parseEnvironmentUrl(result.url);
    const metadata = await client.metadata(
      parsed.environmentId,
      parsed.readCapability,
    );
    expect(metadata.currentRevisionId).toBe(
      result.environment.currentRevisionId,
    );
    expect(metadata.currentRevision?.blobs).toHaveLength(1);
    expect(result.summary.files).toBe(1);
    expect(result.summary.conversationEvents).toBe(2);
    expect(result.summary.proposalsEnabled).toBe(true);
    expect(
      (await findOwnedEnvironment(result.environment.environmentId, statePath))
        ?.pendingRevision,
    ).toBeUndefined();
  });
});
