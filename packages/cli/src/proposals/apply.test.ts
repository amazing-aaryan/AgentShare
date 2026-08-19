import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { acceptEnvironmentLink } from "../environment/accept.js";
import { createEnvironmentFromCapture } from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import { approveOwnedProposal } from "./apply.js";
import { submitFileReplacement } from "./submit.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentshare-approve-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
  return root;
}

describe("creator proposal approval", () => {
  it("changes the real workspace only after approval and publishes a new revision", async () => {
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
    const ownerState = join(
      await mkdtemp(join(tmpdir(), "agentshare-owner-")),
      "state-v2.json",
    );
    const readerState = join(
      await mkdtemp(join(tmpdir(), "agentshare-reader-")),
      "state-v2.json",
    );
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentshare-reader-cache-"));
    const root = await fixture();
    const capture = {
      sourceAgent: "codex" as const,
      title: "Approval demo",
      workspaceRoot: root,
      conversation: [],
    };
    const shared = await createEnvironmentFromCapture(capture, {
      client,
      statePath: ownerState,
      ttlSeconds: 86400,
      proposalsEnabled: true,
      includeConversation: false,
      includeWorkspace: true,
      now: () => now,
      workspaceOptions: { preferGit: false },
    });
    await acceptEnvironmentLink(shared.url, {
      client,
      statePath: readerState,
      cacheRoot,
      now: () => now,
    });
    const proposal = await submitFileReplacement(
      shared.environment.environmentId,
      "src/value.ts",
      "export const value = 2;\n",
      "Update value",
      { client, statePath: readerState, cacheRoot, now: () => now },
    );

    expect(await readFile(join(root, "src", "value.ts"), "utf8")).toContain(
      "1",
    );
    const approved = await approveOwnedProposal(
      shared.environment.environmentId,
      proposal.proposalId,
      capture,
      {
        client,
        statePath: ownerState,
        now: () => now,
        workspaceOptions: { preferGit: false },
      },
    );
    expect(await readFile(join(root, "src", "value.ts"), "utf8")).toContain(
      "2",
    );
    expect(approved.environment.currentRevisionId).not.toBe(
      shared.environment.currentRevisionId,
    );
    expect(
      (
        await client.metadata(
          shared.environment.environmentId,
          shared.environment.readCapability,
        )
      ).currentRevisionId,
    ).toBe(approved.environment.currentRevisionId);
  });

  it("fails closed when the creator changed the base file after sharing", async () => {
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
    const ownerState = join(
      await mkdtemp(join(tmpdir(), "agentshare-owner-conflict-")),
      "state-v2.json",
    );
    const readerState = join(
      await mkdtemp(join(tmpdir(), "agentshare-reader-conflict-")),
      "state-v2.json",
    );
    const cacheRoot = await mkdtemp(
      join(tmpdir(), "agentshare-reader-cache-conflict-"),
    );
    const root = await fixture();
    const capture = {
      sourceAgent: "codex" as const,
      title: "Conflict demo",
      workspaceRoot: root,
      conversation: [],
    };
    const shared = await createEnvironmentFromCapture(capture, {
      client,
      statePath: ownerState,
      ttlSeconds: 86400,
      proposalsEnabled: true,
      includeConversation: false,
      includeWorkspace: true,
      now: () => now,
      workspaceOptions: { preferGit: false },
    });
    await acceptEnvironmentLink(shared.url, {
      client,
      statePath: readerState,
      cacheRoot,
      now: () => now,
    });
    const proposal = await submitFileReplacement(
      shared.environment.environmentId,
      "src/value.ts",
      "export const value = 2;\n",
      "Update value",
      { client, statePath: readerState, cacheRoot, now: () => now },
    );
    await writeFile(
      join(root, "src", "value.ts"),
      "export const value = 99;\n",
    );
    await expect(
      approveOwnedProposal(
        shared.environment.environmentId,
        proposal.proposalId,
        capture,
        {
          client,
          statePath: ownerState,
          now: () => now,
          workspaceOptions: { preferGit: false },
        },
      ),
    ).rejects.toThrow(/conflict|hash/iu);
    expect(await readFile(join(root, "src", "value.ts"), "utf8")).toContain(
      "99",
    );
  });
});
