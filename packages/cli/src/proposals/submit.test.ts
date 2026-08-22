import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { acceptEnvironmentLink } from "../environment/accept.js";
import { createEnvironmentFromCapture } from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import { listOwnedProposals } from "./inbox.js";
import { submitFileReplacement } from "./submit.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentshare-proposal-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
  return root;
}

describe("encrypted proposal submission", () => {
  it("lets a recipient submit a whole-file replacement only the owner can decrypt", async () => {
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
      await mkdtemp(join(tmpdir(), "agentshare-owner-")),
      "state-v2.json",
    );
    const recipientState = join(
      await mkdtemp(join(tmpdir(), "agentshare-reader-")),
      "state-v2.json",
    );
    const cacheRoot = await mkdtemp(
      join(tmpdir(), "agentshare-proposal-cache-"),
    );
    const root = await fixture();
    const shared = await createEnvironmentFromCapture(
      {
        sourceAgent: "codex",
        title: "Proposal demo",
        workspaceRoot: root,
        conversation: [],
      },
      {
        client,
        statePath: creatorState,
        ttlSeconds: 86400,
        proposalsEnabled: true,
        includeConversation: false,
        includeWorkspace: true,
        now: () => now,
        workspaceOptions: { preferGit: false },
      },
    );
    await acceptEnvironmentLink(shared.url, {
      client,
      statePath: recipientState,
      cacheRoot,
      now: () => now,
    });

    const submitted = await submitFileReplacement(
      shared.environment.environmentId,
      "src/value.ts",
      "export const value = 2;\n",
      "Update demo value",
      { client, statePath: recipientState, cacheRoot, now: () => now },
    );
    const inbox = await listOwnedProposals(shared.environment.environmentId, {
      client,
      statePath: creatorState,
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.proposal.proposalId).toBe(submitted.proposalId);
    expect(inbox[0]?.proposal.operations[0]?.type).toBe("replace");
    expect(inbox[0]?.proposal.summary).toBe("Update demo value");
  });
});
