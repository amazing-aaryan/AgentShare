import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, it, vi } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "./environment/relay-client.js";
import { createCreatorRuntime, runCreatorMcpServer } from "./creator-mcp.js";
import type { DraftReview } from "./environment/drafts.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentshare-creator-test-"));
  const state = await mkdtemp(join(tmpdir(), "agentshare-creator-state-"));
  await writeFile(join(root, "notes.txt"), "harmless review fixture");
  const handler = createRelayHandler(new InMemoryRelayStore());
  const fetcher = vi.fn<typeof fetch>((url, init) =>
    handler(new Request(url, init)),
  );
  const client = new EnvironmentRelayClient("http://127.0.0.1:8787", fetcher);
  const options = {
    client,
    statePath: join(state, "state-v2.json"),
    relayOrigin: client.origin,
    handoffOrigin: "http://127.0.0.1:8788",
    confirm: vi.fn(() => Promise.resolve(false)),
    capture: () =>
      Promise.resolve({
        sourceAgent: "codex" as const,
        title: "Synthetic",
        workspaceRoot: root,
        conversation: [
          {
            sequence: 0,
            role: "user" as const,
            kind: "message" as const,
            sourceId: "fixture",
            text: "Fixture conversation",
          },
        ],
      }),
  };
  const runtime = createCreatorRuntime(options);
  const session = (await runtime("resolve_creator_session", {
    threadId: "explicit-fixture",
  })) as { sessionRef: string };
  const draft = (await runtime("prepare_share", {
    sessionRef: session.sessionRef,
    scope: "both",
    access: "read_propose",
    ttlSeconds: 900,
  })) as DraftReview;
  return { root, options, runtime, draft, fetcher };
}

describe("creator MCP consent boundary", () => {
  it("returns bounded retained review, rejects fake approval arguments and unknown sessions", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "notes.txt"), "unreviewed later content");
    const review = (await f.runtime("review_share", {
      draftId: f.draft.draftId,
      digest: f.draft.digest,
      section: "files",
    })) as { content: string };
    expect(review.content).toContain("harmless review fixture");
    expect(review.content).not.toContain("unreviewed later content");
    await expect(
      f.runtime("commit_share", {
        draftId: f.draft.draftId,
        digest: f.draft.digest,
        approved: true,
      }),
    ).rejects.toThrow("Unexpected");
    await expect(
      f.runtime("prepare_share", {
        sessionRef: "latest",
        scope: "both",
        access: "read",
        ttlSeconds: 900,
      }),
    ).rejects.toThrow("SESSION_REQUIRED");
    const resolved = (await f.runtime("resolve_creator_session", {
      threadId: "explicit-fixture",
    })) as { sessionRef: string };
    await expect(
      f.runtime("prepare_share", {
        sessionRef: resolved.sessionRef,
        scope: "both",
        access: "read",
        ttlSeconds: 900,
        workspaceRootOverride: "relative-folder",
      }),
    ).rejects.toThrow("absolute path");
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.options.confirm).not.toHaveBeenCalled();
  });
  it.each([
    "unsupported",
    "decline",
    "cancel",
    "wrong-request",
    "timeout",
  ] as const)(
    "multiplexes host form response and fails closed for %s",
    async (scenario) => {
      const supportsForm = scenario !== "unsupported";
      const f = await fixture();
      const input = new PassThrough(),
        output = new PassThrough();
      const messages: Array<Record<string, unknown>> = [];
      const reader = createInterface({ input: output });
      const received = new Promise<void>((resolve) => {
        reader.on("line", (line) => {
          const message = JSON.parse(line) as Record<string, unknown>;
          messages.push(message);
          if (
            message.method === "elicitation/create" &&
            scenario !== "timeout"
          ) {
            // Synthetic protocol client response only: not evidence of native host UI.
            input.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id:
                  scenario === "wrong-request"
                    ? "unrelated-consent-request"
                    : message.id,
                result:
                  scenario === "wrong-request"
                    ? { action: "accept", content: { confirm: true } }
                    : { action: scenario },
              }) + "\n",
            );
          }
          if (message.id === 2) resolve();
        });
      });
      const running = runCreatorMcpServer({
        statePath: f.options.statePath,
        client: f.options.client,
        input,
        output,
        approvalTimeoutMs: 1000,
      });
      input.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: supportsForm ? { elicitation: { form: {} } } : {},
          },
        }) + "\n",
      );
      input.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "commit_share",
            arguments: { draftId: f.draft.draftId, digest: f.draft.digest },
          },
        }) + "\n",
      );
      await received;
      input.end();
      await running;
      reader.close();
      output.end();
      const reply = messages.find((message) => message.id === 2);
      expect(reply?.result).toMatchObject({ isError: true });
      expect(
        messages.some((message) => message.method === "elicitation/create"),
      ).toBe(supportsForm);
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
});
