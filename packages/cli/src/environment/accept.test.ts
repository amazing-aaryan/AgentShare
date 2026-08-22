import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "./relay-client.js";
import { createEnvironmentFromCapture } from "./publication.js";
import {
  acceptEnvironmentLink,
  readAttachedFile,
  searchAttachedEnvironment,
} from "./accept.js";

async function creatorFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentshare-accept-creator-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "auth.ts"),
    "export function authenticate(token: string) { return token === 'trusted'; }\n",
  );
  return root;
}

describe("recipient environment attachment", () => {
  it("accepts one link, caches ciphertext, and supports safe file search/read", async () => {
    const now = new Date();
    const handler = createRelayHandler(new InMemoryRelayStore(), {
      now: () => now,
    });
    const fetchImpl: typeof fetch = (input, init) =>
      handler(new Request(input, init));
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );
    const creatorState = join(
      await mkdtemp(join(tmpdir(), "agentshare-creator-state-")),
      "state-v2.json",
    );
    const creatorRoot = await creatorFixture();
    const shared = await createEnvironmentFromCapture(
      {
        sourceAgent: "codex",
        title: "Auth project",
        workspaceRoot: creatorRoot,
        conversation: [
          {
            sequence: 0,
            role: "user",
            kind: "message",
            text: "Authentication uses a trusted token.",
            sourceId: "thread",
          },
        ],
      },
      {
        client,
        statePath: creatorState,
        ttlSeconds: 86400,
        proposalsEnabled: true,
        includeConversation: true,
        includeWorkspace: true,
        now: () => now,
        workspaceOptions: { preferGit: false },
      },
    );

    const recipientState = join(
      await mkdtemp(join(tmpdir(), "agentshare-recipient-state-")),
      "state-v2.json",
    );
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentshare-cache-"));
    const attached = await acceptEnvironmentLink(shared.url, {
      client,
      statePath: recipientState,
      cacheRoot,
      now: () => now,
    });

    expect(attached.title).toBe("Auth project");
    expect(attached.files).toBe(1);
    expect(attached.conversationEvents).toBe(1);
    const hits = await searchAttachedEnvironment(
      attached.environmentId,
      "authenticate trusted token",
      { statePath: recipientState, cacheRoot },
    );
    expect(hits.some((hit) => hit.source === "src/auth.ts")).toBe(true);
    expect(
      await readAttachedFile(attached.environmentId, "src/auth.ts", {
        statePath: recipientState,
        cacheRoot,
      }),
    ).toContain("authenticate");
  });
});
