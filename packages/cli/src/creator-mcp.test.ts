import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, it, vi } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "./environment/relay-client.js";
import {
  createCreatorRuntime,
  creatorDoctor,
  runCreatorMcpServer,
} from "./creator-mcp.js";
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
  it.each([
    "install",
    "install-set-default",
    "cancel",
    "cancel-with-default",
    "host-cancel",
    "incomplete",
    "missing-default",
  ] as const)(
    "offers first-use setup and writes skills only after native %s choice",
    async (choice) => {
      const input = new PassThrough();
      const output = new PassThrough();
      const messages: Array<Record<string, unknown>> = [];
      const installSkills = vi.fn(() => Promise.resolve(["managed skill"]));
      const installCli = vi.fn();
      const enableApprovalDefault = vi.fn(() => Promise.resolve());
      const reader = createInterface({ input: output });
      const received = new Promise<void>((resolve) => {
        reader.on("line", (line) => {
          const message = JSON.parse(line) as Record<string, unknown>;
          messages.push(message);
          if (message.method === "elicitation/create")
            input.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: message.id,
                result:
                  choice === "host-cancel"
                    ? { action: "cancel" }
                    : {
                        action: "accept",
                        content: {
                          setup:
                            choice === "incomplete"
                              ? "yes"
                              : choice === "install-set-default"
                                ? "install"
                                : choice === "cancel-with-default"
                                  ? "cancel"
                                  : choice === "missing-default"
                                    ? "install"
                                    : choice,
                          approvalDefault:
                            choice === "install-set-default" ||
                            choice === "cancel-with-default"
                              ? "on_request"
                              : choice === "missing-default"
                                ? undefined
                                : "keep",
                        },
                      },
              }) + "\n",
            );
          if (message.id === 2) resolve();
        });
      });
      const running = runCreatorMcpServer({
        input,
        output,
        installSkills,
        installCli,
        enableApprovalDefault,
        cliCurrent: () => false,
        skillsCurrent: () => Promise.resolve(false),
        approvalTimeoutMs: 1000,
      });
      input.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { capabilities: { elicitation: { form: {} } } },
        }) + "\n",
      );
      input.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "setup_agentshare", arguments: {} },
        }) + "\n",
      );
      await received;
      input.end();
      await running;
      reader.close();
      output.end();
      const reply = messages.find((message) => message.id === 2);
      const initialization = messages.find((message) => message.id === 1)
        ?.result as { instructions?: string } | undefined;
      expect(initialization?.instructions).toContain("setup_agentshare");
      if (choice === "install" || choice === "install-set-default") {
        expect(installSkills).toHaveBeenCalledOnce();
        expect(installCli).toHaveBeenCalledOnce();
        expect(enableApprovalDefault).toHaveBeenCalledTimes(
          choice === "install-set-default" ? 1 : 0,
        );
        expect(reply?.result).toMatchObject({ isError: false });
      } else {
        expect(installSkills).not.toHaveBeenCalled();
        expect(installCli).not.toHaveBeenCalled();
        expect(enableApprovalDefault).not.toHaveBeenCalled();
        expect(reply?.result).toMatchObject({
          isError: choice === "incomplete" || choice === "missing-default",
        });
      }
    },
  );

  it("points Codex 0.155.1 users to /permissions, not the removed /approvals command", () => {
    const next = creatorDoctor().next;
    expect(next).toContain("/permissions");
    expect(next).toContain("no /approvals command");
    expect(next).not.toContain("run /approvals");
  });

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
    "accepted-without-confirmation",
    "wrong-confirmation",
    "host-error",
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
                ...(scenario === "host-error"
                  ? { error: { code: -32603, message: "Host form failed" } }
                  : {
                      result:
                        scenario === "wrong-request"
                          ? {
                              action: "accept",
                              content: { confirmation: "approve" },
                            }
                          : scenario === "accepted-without-confirmation"
                            ? { action: "accept", content: {} }
                            : scenario === "wrong-confirmation"
                              ? {
                                  action: "accept",
                                  content: { confirmation: "NO" },
                                }
                              : { action: scenario },
                    }),
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
      const error = (reply?.result as { content: Array<{ text: string }> })
        .content[0]?.text;
      if (
        scenario === "accepted-without-confirmation" ||
        scenario === "wrong-confirmation"
      )
        expect(error).toContain("HUMAN_APPROVAL_INCOMPLETE");
      if (scenario === "host-error")
        expect(error).toContain("HUMAN_APPROVAL_UNAVAILABLE");
      if (scenario === "decline" || scenario === "cancel")
        expect(error).toContain("HUMAN_APPROVAL_DECLINED");
      if (scenario === "timeout" || scenario === "wrong-request")
        expect(error).toContain("HUMAN_APPROVAL_TIMEOUT");
      expect(
        messages.some((message) => message.method === "elicitation/create"),
      ).toBe(supportsForm);
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("publishes only after an explicit native select choice", async () => {
    const f = await fixture();
    const input = new PassThrough(),
      output = new PassThrough();
    const messages: Array<Record<string, unknown>> = [];
    const reader = createInterface({ input: output });
    const received = new Promise<void>((resolve) => {
      reader.on("line", (line) => {
        const message = JSON.parse(line) as Record<string, unknown>;
        messages.push(message);
        if (message.method === "elicitation/create") {
          const params = message.params as {
            requestedSchema: { properties: Record<string, unknown> };
          };
          expect(params.requestedSchema.properties).toHaveProperty(
            "confirmation",
          );
          expect(params.requestedSchema.properties).not.toHaveProperty(
            "confirm",
          );
          expect(params.requestedSchema.properties.confirmation).toMatchObject({
            type: "string",
            title: "Choose an action",
            oneOf: [
              { const: "approve", title: "Publish exact reviewed draft" },
              { const: "cancel", title: "Cancel" },
            ],
          });
          input.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                action: "accept",
                content: { confirmation: "approve" },
              },
            }) + "\n",
          );
        }
        if (message.id === 2) resolve();
      });
    });
    const running = runCreatorMcpServer({
      statePath: f.options.statePath,
      client: f.options.client,
      capture: f.options.capture,
      relayOrigin: f.options.relayOrigin,
      handoffOrigin: f.options.handoffOrigin,
      input,
      output,
    });
    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: { elicitation: { form: {} } },
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
    expect(reply?.result).toMatchObject({ isError: false });
    expect(f.fetcher).toHaveBeenCalled();
  });
  it("uses native arrow-key choices for share options and binds them server-side", async () => {
    const f = await fixture();
    const input = new PassThrough(),
      output = new PassThrough();
    const messages: Array<Record<string, unknown>> = [];
    const reader = createInterface({ input: output });
    const completed = new Promise<void>((resolve, reject) => {
      reader.on("line", (line) => {
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          messages.push(message);
          if (message.method === "elicitation/create") {
            const params = message.params as {
              requestedSchema: {
                properties: Record<string, Record<string, unknown>>;
              };
            };
            expect(params.requestedSchema.properties).toHaveProperty("files");
            expect(params.requestedSchema.properties).toHaveProperty("access");
            expect(params.requestedSchema.properties).toHaveProperty(
              "duration",
            );
            for (const property of ["files", "access", "duration"]) {
              expect(
                params.requestedSchema.properties[property],
              ).toHaveProperty("type", "string");
              expect(
                Array.isArray(
                  params.requestedSchema.properties[property]?.oneOf,
                ),
              ).toBe(true);
            }
            expect(params.requestedSchema).toMatchObject({
              required: ["files", "access", "duration"],
            });
            input.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  action: "accept",
                  content: {
                    files: "both",
                    access: "read_propose",
                    duration: "86400",
                  },
                },
              }) + "\n",
            );
          }
          if (message.id === 2) {
            const result = message.result as {
              content: Array<{ text: string }>;
            };
            const resolved = JSON.parse(result.content[0]?.text ?? "") as {
              sessionRef: string;
            };
            input.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: {
                  name: "select_share_options",
                  arguments: { sessionRef: resolved.sessionRef },
                },
              }) + "\n",
            );
          }
          if (message.id === 3) {
            const result = message.result as {
              content: Array<{ text: string }>;
            };
            const selected = JSON.parse(result.content[0]?.text ?? "") as {
              sessionRef: string;
            };
            input.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 4,
                method: "tools/call",
                params: {
                  name: "prepare_share",
                  arguments: {
                    sessionRef: selected.sessionRef,
                    scope: "conversation",
                    access: "read",
                    ttlSeconds: 3600,
                  },
                },
              }) + "\n",
            );
          }
          if (message.id === 4) resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    const running = runCreatorMcpServer({
      statePath: f.options.statePath,
      client: f.options.client,
      capture: f.options.capture,
      relayOrigin: f.options.relayOrigin,
      handoffOrigin: f.options.handoffOrigin,
      input,
      output,
    });
    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: { elicitation: { form: {} } },
        },
      }) + "\n",
    );
    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "resolve_creator_session",
          arguments: { threadId: "explicit-fixture" },
        },
      }) + "\n",
    );
    await completed;
    input.end();
    await running;
    reader.close();
    output.end();
    const reply = messages.find((message) => message.id === 4);
    expect(reply?.result).toMatchObject({ isError: false });
    const prepared = JSON.parse(
      (reply?.result as { content: Array<{ text: string }> }).content[0]
        ?.text ?? "",
    ) as { policy: Record<string, unknown>; ttlSeconds: number };
    expect(prepared).toMatchObject({
      policy: {
        includeConversation: true,
        includeWorkspace: true,
        proposalsEnabled: true,
      },
      ttlSeconds: 86400,
    });
  });
});
