import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import {
  copyOwnedEnvironmentLink,
  shareCaptureV2,
  shareCurrentV2,
} from "./share-v2.js";
import { chooseOption } from "../tui/input.js";
import { readOwnedSnapshot } from "../environment/owned-snapshot.js";
import {
  findOwnedEnvironment,
  saveOwnedEnvironment,
} from "../environment/state.js";

vi.mock("../tui/input.js", () => ({ chooseOption: vi.fn() }));
const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutDescriptor = Object.getOwnPropertyDescriptor(
  process.stdout,
  "isTTY",
);
beforeEach(() => {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  vi.mocked(chooseOption)
    .mockReset()
    .mockImplementation((_title, choices, initial) => {
      const publish = choices.indexOf("Publish exact reviewed draft");
      return Promise.resolve(publish === -1 ? (initial ?? 0) : publish);
    });
});
afterEach(() => {
  if (stdinDescriptor === undefined)
    Reflect.deleteProperty(process.stdin, "isTTY");
  else Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
  if (stdoutDescriptor === undefined)
    Reflect.deleteProperty(process.stdout, "isTTY");
  else Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentshare-share-v2-"));
  await writeFile(join(root, "README.md"), "first revision\n", "utf8");
  return root;
}

async function statePath(): Promise<string> {
  return join(
    await mkdtemp(join(tmpdir(), "agentshare-share-state-")),
    "state-v2.json",
  );
}

describe("v2 share command", () => {
  it("creates a split-origin 24-hour read-plus-propose environment without free-form input", async () => {
    const root = await fixture();
    const state = await statePath();
    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetchImpl: typeof fetch = (input, init) =>
      handler(new Request(input, init));
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );
    const result = await shareCaptureV2(
      {
        sourceAgent: "codex",
        title: "Codex: demo",
        workspaceRoot: root,
        conversation: [
          {
            sequence: 0,
            role: "user",
            kind: "message",
            text: "Question",
            sourceId: "thread",
          },
        ],
      },
      {
        client,
        handoffOrigin: "https://handoff.example",
        statePath: state,
        selection: {
          includeConversation: true,
          includeWorkspace: true,
          proposalsEnabled: true,
          ttlSeconds: 86400,
        },
        workspaceOptions: { preferGit: false },
      },
    );
    expect(new URL(result.url).origin).toBe("https://handoff.example");
    expect(new URL(result.url).searchParams.get("relay")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(result.summary.files).toBe(1);
    expect(result.environment.sharePolicy.proposalsEnabled).toBe(true);
  });

  it("fails closed instead of choosing an unreviewed non-TTY default", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    const root = await fixture();
    const state = await statePath();
    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetchImpl: typeof fetch = (input, init) =>
      handler(new Request(input, init));
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );

    await expect(
      shareCaptureV2(
        {
          sourceAgent: "codex",
          title: "Codex: demo",
          workspaceRoot: root,
          conversation: [],
        },
        {
          client,
          handoffOrigin: "https://handoff.example",
          statePath: state,
          workspaceOptions: { preferGit: false },
        },
      ),
    ).rejects.toThrow("Interactive creator approval requires a TTY");
  });

  it("updates an existing environment and keeps the same capability URL", async () => {
    const root = await fixture();
    const state = await statePath();
    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetchImpl: typeof fetch = (input, init) =>
      handler(new Request(input, init));
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );
    const capture = {
      sourceAgent: "codex" as const,
      title: "Codex: demo",
      workspaceRoot: root,
      conversation: [
        {
          sequence: 0,
          role: "user" as const,
          kind: "message" as const,
          text: "Question",
          sourceId: "thread",
        },
      ],
    };
    const first = await shareCaptureV2(capture, {
      client,
      handoffOrigin: "https://handoff.example",
      statePath: state,
      selection: {
        includeConversation: true,
        includeWorkspace: true,
        proposalsEnabled: true,
        ttlSeconds: 86400,
      },
      workspaceOptions: { preferGit: false },
    });
    await writeFile(join(root, "README.md"), "second revision\n", "utf8");
    const second = await shareCaptureV2(capture, {
      client,
      handoffOrigin: "https://handoff.example",
      statePath: state,
      existingEnvironmentId: first.environment.environmentId,
      workspaceOptions: { preferGit: false },
    });
    expect(second.url).toBe(first.url);
    expect(second.environment.currentRevisionId).not.toBe(
      first.environment.currentRevisionId,
    );
    const relocatedRoot = await fixture();
    const relocatedCapture = { ...capture, workspaceRoot: relocatedRoot };
    const relocatedOptions = {
      client,
      statePath: state,
      handoffOrigin: "https://handoff.example",
      existingEnvironmentId: first.environment.environmentId,
      workspaceOptions: { preferGit: false },
      recordedRoot: root,
    };
    await expect(
      shareCaptureV2(relocatedCapture, relocatedOptions),
    ).rejects.toThrow("explicit --project-root");
    vi.mocked(chooseOption).mockResolvedValueOnce(0);
    await expect(
      shareCaptureV2(relocatedCapture, {
        ...relocatedOptions,
        projectRoot: relocatedRoot,
      }),
    ).rejects.toThrow("cancelled");
    expect(
      (await findOwnedEnvironment(first.environment.environmentId, state))
        ?.workspaceRoot,
    ).toBe(root);
    vi.mocked(chooseOption).mockImplementationOnce((title) => {
      expect(title).toContain(`Recorded project: ${root}`);
      expect(title).toContain(`Selected project: ${relocatedRoot}`);
      expect(title).toContain(
        `Base revision: ${second.environment.currentRevisionId ?? "missing"}`,
      );
      return Promise.resolve(4);
    });
    const relocated = await shareCaptureV2(relocatedCapture, {
      ...relocatedOptions,
      projectRoot: relocatedRoot,
    });
    expect(relocated.environment.workspaceRoot).toBe(relocatedRoot);
    expect(relocated.environment.relayOrigin).toBe(
      first.environment.relayOrigin,
    );
    expect(relocated.environment.sharePolicy).toEqual(
      first.environment.sharePolicy,
    );
    expect(relocated.url).toBe(first.url);
    // Three publications plus a cancelled relocation exercise real Windows ACL helpers.
  }, 60_000);

  it("creates a fresh environment and applies an explicit ttl override", async () => {
    const root = await fixture();
    const state = await statePath();
    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetchImpl: typeof fetch = (input, init) =>
      handler(new Request(input, init));
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );
    const capture = {
      sourceAgent: "codex" as const,
      title: "Codex: demo",
      workspaceRoot: root,
      conversation: [],
    };
    const selection = {
      includeConversation: true,
      includeWorkspace: true,
      proposalsEnabled: false,
      ttlSeconds: 86400,
    };
    const first = await shareCaptureV2(capture, {
      client,
      statePath: state,
      selection,
      sessionId: "empty-session",
      workspaceOptions: { preferGit: false },
    });
    const before = Date.now();
    const freshOptions = {
      client,
      statePath: state,
      selection,
      sessionId: "empty-session",
      workspaceOptions: { preferGit: false },
      forceNew: true,
      ttlSeconds: 3600,
    };
    const second = await shareCaptureV2(capture, freshOptions);
    const after = Date.now();
    const expiresAt = Date.parse(second.environment.expiresAt);

    expect(second.environment.environmentId).not.toBe(
      first.environment.environmentId,
    );
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 3_600_000);
  });

  it("publishes the reviewed retained bytes after workspace changes and uses cancel as the default", async () => {
    const root = await fixture();
    const retainedText =
      "first revision\n" +
      Array.from({ length: 45 }, (_, index) => `retained line ${index}`).join(
        "\n",
      );
    await writeFile(join(root, "README.md"), retainedText);
    await writeFile(
      join(root, "binary.bin"),
      Buffer.from("\0BINARY_RAW_PAYLOAD_DO_NOT_DISPLAY"),
    );
    const state = await statePath();
    const handler = createRelayHandler(new InMemoryRelayStore());
    const fetcher = vi.fn<typeof fetch>((input, init) =>
      handler(new Request(input, init)),
    );
    const client = new EnvironmentRelayClient("http://127.0.0.1:8787", fetcher);
    const capture = {
      sourceAgent: "codex" as const,
      title: "test",
      workspaceRoot: root,
      conversation: [
        {
          sequence: 0,
          role: "user" as const,
          kind: "message" as const,
          text: "retained question",
          sourceId: "thread",
        },
      ],
    };
    const options = {
      client,
      statePath: state,
      workspaceOptions: { preferGit: false },
      selection: {
        includeConversation: true,
        includeWorkspace: true,
        proposalsEnabled: true,
        ttlSeconds: 3600,
      },
    };
    vi.mocked(chooseOption).mockImplementationOnce(
      (_title, choices, initial) => {
        expect(choices[initial ?? -1]).toBe("Cancel");
        expect(fetcher).not.toHaveBeenCalled();
        return Promise.resolve(0);
      },
    );
    await expect(shareCaptureV2(capture, options)).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
    let reviewCount = 0;
    const fileScreens: string[] = [];
    vi.mocked(chooseOption).mockImplementation(async (title, choices) => {
      if (choices.includes("Publish exact reviewed draft")) {
        expect(title).toContain("Relay: http://127.0.0.1:8787");
        expect(title).toContain("Base revision: <none>");
        expect(title).toContain("Capture cutoff:");
        expect(title).toContain("Scope: conversation + workspace");
        reviewCount++;
        if (reviewCount === 1) {
          await writeFile(join(root, "README.md"), "unreviewed edit\n");
          const event = capture.conversation[0];
          if (event === undefined) throw new Error("Missing fixture event");
          event.text = "unreviewed question";
          return 1;
        }
        if (reviewCount === 2) return 2;
        return 4;
      }
      if (title.startsWith("Retained file contents")) {
        fileScreens.push(title);
        const page = /\((\d+)\/(\d+)\)/u.exec(title);
        if (page === null) throw new Error("Missing page indicator");
        return Number(page[1]) < Number(page[2]) ? 1 : 0;
      }
      expect(title).toContain("retained question");
      expect(title).not.toContain("unreviewed question");
      return 0;
    });
    const published = await shareCaptureV2(capture, options);
    const owned = await readOwnedSnapshot(published.environment, client);
    const retainedReadme = owned.snapshot.files.find(
      (file) => file.path === "README.md",
    );
    if (retainedReadme === undefined)
      throw new Error("Retained README missing");
    expect(Buffer.from(retainedReadme.contentBase64, "base64").toString()).toBe(
      retainedText,
    );
    expect(owned.capture.conversation[0]?.text).toBe("retained question");
    expect(fileScreens.length).toBeGreaterThan(1);
    expect(fileScreens.join("\n")).toContain("first revision");
    expect(fileScreens.join("\n")).toContain("<binary: metadata only");
    expect(fileScreens.join("\n")).not.toContain("BINARY_RAW_PAYLOAD");
    expect(fileScreens.join("\n")).not.toContain("unreviewed edit");
    expect(vi.mocked(chooseOption).mock.calls[1]?.[0]).toContain("Digest:");
  });

  it("copies from saved state without capture and refuses unpublished links", async () => {
    const root = await fixture();
    const state = await statePath();
    const handler = createRelayHandler(new InMemoryRelayStore());
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      (input, init) => handler(new Request(input, init)),
    );
    const result = await shareCaptureV2(
      {
        sourceAgent: "codex",
        title: "copy test",
        workspaceRoot: root,
        conversation: [],
      },
      {
        client,
        statePath: state,
        sessionId: "explicit",
        workspaceOptions: { preferGit: false },
        selection: {
          includeConversation: false,
          includeWorkspace: true,
          proposalsEnabled: false,
          ttlSeconds: 3600,
        },
      },
    );
    expect(
      await copyOwnedEnvironmentLink(result.environment.environmentId, state),
    ).toBe(result.url);
    vi.mocked(chooseOption).mockResolvedValueOnce(2);
    // No session identity is required on this existing-link management branch.
    expect(
      (await shareCurrentV2("codex", { projectRoot: root, statePath: state }))
        .url,
    ).toBe(result.url);
    const duplicate = {
      ...result.environment,
      environmentId: "env_duplicate_1234567890123",
      generation: 0,
    };
    await saveOwnedEnvironment(duplicate, state);
    vi.mocked(chooseOption)
      .mockImplementationOnce((title, choices, initial) => {
        expect(title).toContain("Choose exact existing environment");
        expect(choices[initial ?? -1]).toBe("Cancel");
        expect(choices[1]).toContain(result.environment.environmentId);
        expect(choices[2]).toContain(duplicate.environmentId);
        return Promise.resolve(2);
      })
      .mockResolvedValueOnce(2);
    expect(
      (await shareCurrentV2("codex", { projectRoot: root, statePath: state }))
        .environment.environmentId,
    ).toBe(duplicate.environmentId);
    result.environment.currentRevisionId = null;
    await saveOwnedEnvironment(result.environment, state);
    await expect(
      copyOwnedEnvironmentLink(result.environment.environmentId, state),
    ).rejects.toThrow("pending");
  });
});