import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptEnvironmentLink, readAttachedFile } from "./accept.js";
import { createEnvironmentFromCapture } from "./publication.js";
import { refreshAttachedEnvironment } from "./refresh.js";
import { EnvironmentRelayClient } from "./relay-client.js";
import { approveOwnedProposal } from "../proposals/apply.js";
import { listOwnedProposals } from "../proposals/inbox.js";
import { submitFileReplacement } from "../proposals/submit.js";

const relay = process.env.AGENTSHARE_E2E_RELAY?.trim();

describe.skipIf(!relay)("public AgentShare v2 environment", () => {
  it("publishes, attaches, proposes, approves, and refreshes through the deployed relay", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-public-v2-"));
    const workspace = join(root, "workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
    await writeFile(join(workspace, "value.txt"), "one\n", "utf8");
    const ownerState = join(root, "owner-state.json");
    const recipientState = join(root, "recipient-state.json");
    const recipientCache = join(root, "recipient-cache");
    const client = new EnvironmentRelayClient(requiredRelay());
    const capture = {
      sourceAgent: "codex" as const,
      title: "AgentShare release v2",
      workspaceRoot: workspace,
      conversation: [],
    };
    const created = await createEnvironmentFromCapture(capture, {
      client,
      statePath: ownerState,
      ttlSeconds: 120,
      proposalsEnabled: true,
      includeConversation: false,
      includeWorkspace: true,
      workspaceOptions: { preferGit: false },
    });
    try {
      const attached = await acceptEnvironmentLink(created.url, {
        client,
        statePath: recipientState,
        cacheRoot: recipientCache,
      });
      expect(attached.canPropose).toBe(true);
      expect(
        await readAttachedFile(created.environment.environmentId, "value.txt", {
          statePath: recipientState,
          cacheRoot: recipientCache,
        }),
      ).toBe("one\n");

      const proposal = await submitFileReplacement(
        created.environment.environmentId,
        "value.txt",
        "two\n",
        "Release-gate update",
        {
          client,
          statePath: recipientState,
          cacheRoot: recipientCache,
        },
      );
      expect(
        (
          await listOwnedProposals(created.environment.environmentId, {
            client,
            statePath: ownerState,
          })
        ).some((item) => item.proposal.proposalId === proposal.proposalId),
      ).toBe(true);

      await approveOwnedProposal(
        created.environment.environmentId,
        proposal.proposalId,
        capture,
        {
          client,
          statePath: ownerState,
          workspaceOptions: { preferGit: false },
        },
      );
      expect(
        await refreshAttachedEnvironment(created.environment.environmentId, {
          client,
          statePath: recipientState,
          cacheRoot: recipientCache,
        }),
      ).toBe(true);
      expect(
        await readAttachedFile(created.environment.environmentId, "value.txt", {
          statePath: recipientState,
          cacheRoot: recipientCache,
        }),
      ).toBe("two\n");
    } finally {
      await client
        .revoke(
          created.environment.environmentId,
          created.environment.revokeCapability,
        )
        .catch(() => undefined);
    }
  });
});

function requiredRelay(): string {
  if (relay === undefined || relay.length === 0) {
    throw new Error("AGENTSHARE_E2E_RELAY is required for the public v2 gate");
  }
  return relay;
}
