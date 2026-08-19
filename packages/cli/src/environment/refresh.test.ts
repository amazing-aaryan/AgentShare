import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "./relay-client.js";
import {
  createEnvironmentFromCapture,
  publishEnvironmentRevision,
} from "./publication.js";
import { acceptEnvironmentLink, readAttachedFile } from "./accept.js";
import { refreshAttachedEnvironment } from "./refresh.js";

describe("attached environment refresh", () => {
  it("advances the local encrypted cache when the same environment gets a new revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-refresh-"));
    const statePath = join(root, "state-v2.json");
    const cacheRoot = join(root, "cache");
    await writeFile(join(root, "value.txt"), "one\n", "utf8");
    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetchImpl: typeof fetch = (input, init) =>
      handler(new Request(input, init));
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );
    const capture = {
      sourceAgent: "codex" as const,
      title: "demo",
      workspaceRoot: root,
      conversation: [],
    };
    const created = await createEnvironmentFromCapture(capture, {
      client,
      statePath,
      ttlSeconds: 86400,
      proposalsEnabled: true,
      includeConversation: false,
      includeWorkspace: true,
      workspaceOptions: { preferGit: false },
    });
    await acceptEnvironmentLink(created.url, { client, statePath, cacheRoot });
    expect(
      await readAttachedFile(created.environment.environmentId, "value.txt", {
        statePath,
        cacheRoot,
      }),
    ).toBe("one\n");

    await writeFile(join(root, "value.txt"), "two\n", "utf8");
    await publishEnvironmentRevision(capture, created.environment, client, {
      statePath,
      workspaceOptions: { preferGit: false },
    });
    expect(
      await refreshAttachedEnvironment(created.environment.environmentId, {
        client,
        statePath,
        cacheRoot,
      }),
    ).toBe(true);
    expect(
      await readAttachedFile(created.environment.environmentId, "value.txt", {
        statePath,
        cacheRoot,
      }),
    ).toBe("two\n");
  });
});
