import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { acceptEnvironmentLink, readAttachedFile } from "./accept.js";
import { createEnvironmentFromCapture } from "./publication.js";
import { refreshAttachedEnvironment } from "./refresh.js";
import { EnvironmentRelayClient } from "./relay-client.js";
import { approveOwnedProposal } from "../proposals/apply.js";
import { listOwnedProposals } from "../proposals/inbox.js";
import { submitFileReplacement } from "../proposals/submit.js";

describe("AgentShare v2 collaboration journey", () => {
  it("keeps one link from read access through proposal approval and the next revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-collaboration-"));
    const ownerState = join(root, "owner-state.json");
    const recipientState = join(root, "recipient-state.json");
    const recipientCache = join(root, "recipient-cache");
    const workspace = join(root, "workspace");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
    await writeFile(join(workspace, "value.txt"), "one\n", "utf8");

    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetchImpl: typeof fetch = (input, init) => handler(new Request(input, init));
    const client = new EnvironmentRelayClient("http://127.0.0.1:8787", fetchImpl);
    const capture = {
      sourceAgent: "codex" as const,
      title: "demo",
      workspaceRoot: workspace,
      conversation: [
        {
          sequence: 0,
          role: "user" as const,
          kind: "message" as const,
          text: "Keep the value easy to inspect.",
          sourceId: "thread",
        },
      ],
    };

    const created = await createEnvironmentFromCapture(capture, {
      client,
      statePath: ownerState,
      ttlSeconds: 86400,
      proposalsEnabled: true,
      includeConversation: true,
      includeWorkspace: true,
      workspaceOptions: { preferGit: false },
    });
    const originalUrl = created.url;
    await acceptEnvironmentLink(originalUrl, {
      client,
      statePath: recipientState,
      cacheRoot: recipientCache,
    });
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
      "Change value to two",
      {
        client,
        statePath: recipientState,
        cacheRoot: recipientCache,
      },
    );
    const inbox = await listOwnedProposals(created.environment.environmentId, {
      client,
      statePath: ownerState,
    });
    expect(inbox.map((item) => item.proposal.proposalId)).toContain(
      proposal.proposalId,
    );

    const approved = await approveOwnedProposal(
      created.environment.environmentId,
      proposal.proposalId,
      capture,
      {
        client,
        statePath: ownerState,
        workspaceOptions: { preferGit: false },
      },
    );
    expect(await readFile(join(workspace, "value.txt"), "utf8")).toBe("two\n");
    expect(approved.environment.currentRevisionId).not.toBe(
      created.environment.currentRevisionId,
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
    expect(originalUrl).toBe(created.url);
  });
});
