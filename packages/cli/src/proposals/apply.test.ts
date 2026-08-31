import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptProposalForOwner, randomCapability } from "@agentshare/acb";
import type {
  AgentShareProposal,
  ProposalOperation,
} from "@agentshare/contracts";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { acceptEnvironmentLink } from "../environment/accept.js";
import {
  createEnvironmentFromCapture,
  publishEnvironmentRevision,
  resumePendingRevision,
} from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import * as publication from "../environment/publication.js";
import * as environmentState from "../environment/state.js";
import * as privateStore from "../environment/private-store.js";
import {
  findOwnedEnvironment,
  loadEnvironmentState,
} from "../environment/state.js";
import { readOwnedSnapshot } from "../environment/owned-snapshot.js";
import { approveOwnedProposal, prepareOwnedProposalReview } from "./apply.js";
import { listOwnedProposals } from "./inbox.js";
import { submitFileReplacement } from "./submit.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
afterEach(() => vi.restoreAllMocks());

function hash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function proposalFixture(content = "export const value = 1;\n") {
  const root = await fixture();
  await writeFile(join(root, "src/value.ts"), content);
  await writeFile(join(root, "unchanged.txt"), "approved bytes\r\n");
  const ownerState = join(
    await mkdtemp(join(tmpdir(), "agentshare-pr5-state-")),
    "state-v2.json",
  );
  const handler = createRelayHandler(new InMemoryRelayStore());
  const client = new EnvironmentRelayClient(
    "http://127.0.0.1:8787",
    (input, init) => handler(new Request(input, init)),
  );
  const capture = {
    sourceAgent: "codex" as const,
    title: "Approved title",
    workspaceRoot: root,
    conversation: [
      {
        sequence: 0,
        sourceId: "approved-thread",
        role: "user" as const,
        kind: "message" as const,
        text: "Approved conversation",
      },
    ],
  };
  const shared = await createEnvironmentFromCapture(capture, {
    client,
    statePath: ownerState,
    ttlSeconds: 86400,
    proposalsEnabled: true,
    includeConversation: true,
    includeWorkspace: true,
    workspaceOptions: { preferGit: false },
  });
  const base = await readOwnedSnapshot(shared.environment, client);
  const file = base.snapshot.files.find(
    (entry) => entry.path === "src/value.ts",
  );
  if (file === undefined) throw new Error("Missing fixture base");
  const operation: ProposalOperation = {
    type: "replace",
    path: file.path,
    baseSha256: file.sha256,
    newSha256: hash("export const value = 2;\n"),
    mediaType: file.mediaType,
    contentBase64: Buffer.from("export const value = 2;\n").toString("base64"),
  };
  const options = { client, statePath: ownerState };
  // Encrypt directly so hostile recipient fixtures cannot be rejected by sender-side scanning.
  async function submit(
    operations: ProposalOperation[] = [operation],
    summary = "Approved operation",
  ) {
    const owned = shared.environment;
    if (
      owned.proposalPublicKey === undefined ||
      owned.proposalCapability === undefined ||
      owned.currentRevisionId === null
    )
      throw new Error("Missing fixture capabilities");
    const proposal: AgentShareProposal = {
      version: "agentshare-proposal-v1",
      proposalId: `prop_${randomCapability(18)}`,
      environmentId: owned.environmentId,
      baseRevisionId: owned.currentRevisionId,
      createdAt: new Date().toISOString(),
      summary,
      operations,
    };
    const encrypted = encryptProposalForOwner(
      Buffer.from(JSON.stringify(proposal)),
      owned.proposalPublicKey,
      { environmentId: owned.environmentId, proposalId: proposal.proposalId },
    );
    await client.submitProposal(
      owned.environmentId,
      owned.proposalCapability,
      {
        proposalId: proposal.proposalId,
        baseRevisionId: proposal.baseRevisionId,
        createdAt: proposal.createdAt,
        ciphertextSha256: encrypted.ciphertextSha256,
        ciphertextBytes: encrypted.envelope.length,
        ephemeralPublicKey: encrypted.ephemeralPublicKey,
      },
      encrypted.envelope,
    );
    return proposal;
  }
  return {
    root,
    capture,
    shared,
    base,
    operation,
    client,
    ownerState,
    options,
    submit,
  };
}

function createOperation(
  path: string,
  bytes = Buffer.from("safe\n"),
  mediaType = "text/plain",
): ProposalOperation {
  return {
    type: "create",
    path,
    mediaType,
    newSha256: hash(bytes),
    contentBase64: bytes.toString("base64"),
  };
}

describe("scoped proposal application", () => {
  it("publishes only the approved base overlay without recapturing files or conversation", async () => {
    const setup = await proposalFixture();
    const proposal = await setup.submit();
    const review = await prepareOwnedProposalReview(
      proposal.environmentId,
      proposal.proposalId,
      setup.options,
    );
    await writeFile(join(setup.root, "unchanged.txt"), "unrelated local edit");
    await writeFile(join(setup.root, "private-new.txt"), "unrelated new file");
    setup.capture.title = "Unapproved title";
    const event = setup.capture.conversation[0];
    if (event === undefined) throw new Error("Missing fixture conversation");
    event.text = "Unapproved conversation";
    setup.capture.workspaceRoot = "does-not-exist";
    const result = await approveOwnedProposal(
      proposal.environmentId,
      proposal.proposalId,
      setup.capture,
      { ...setup.options, reviewDigest: review.digest },
    );
    const outbound = await readOwnedSnapshot(result.environment, setup.client);
    expect(outbound.capture.title).toBe("Approved title");
    expect(outbound.capture.conversation[0]?.text).toBe(
      "Approved conversation",
    );
    expect(
      outbound.snapshot.files.find((file) => file.path === "unchanged.txt")
        ?.contentBase64,
    ).toBe(Buffer.from("approved bytes\r\n").toString("base64"));
    expect(
      outbound.snapshot.files.some((file) => file.path === "private-new.txt"),
    ).toBe(false);
    expect(await readFile(join(setup.root, "unchanged.txt"), "utf8")).toBe(
      "unrelated local edit",
    );
    expect((await loadEnvironmentState(setup.ownerState)).transactions).toEqual(
      [],
    );
  }, 120_000);

  it("checks membership, credential policy, ignore rules and portable paths before review", async () => {
    const setup = await proposalFixture();
    await promisify(execFile)("git", ["-C", setup.root, "init"], {
      windowsHide: true,
    });
    await writeFile(join(setup.root, ".gitignore"), "gitignored/\n");
    await writeFile(join(setup.root, ".agentshareignore"), "ignored/\n");
    await writeFile(join(setup.root, "private.txt"), "not shared");
    const operations = [
      ...[
        ".env",
        ".env/nested.txt",
        ".ssh/config",
        "node_modules/new.txt",
        "nested/.git/config",
        "ignored/new.txt",
        "gitignored/new.txt",
        "NUL.txt",
        "src/file:stream",
        "src/trailing.",
        "src/hidden\u202e.txt",
      ].map((path) => createOperation(path)),
      {
        type: "replace" as const,
        path: "private.txt",
        baseSha256: hash("not shared"),
        newSha256: hash("safe"),
        mediaType: "text/plain",
        contentBase64: Buffer.from("safe").toString("base64"),
      },
    ];
    for (const operation of operations) {
      const proposal = await setup.submit([operation]);
      await expect(
        prepareOwnedProposalReview(
          proposal.environmentId,
          proposal.proposalId,
          setup.options,
        ),
      ).rejects.toThrow(/excluded|Unsafe|approved snapshot/u);
    }
    expect(await readFile(join(setup.root, "private.txt"), "utf8")).toBe(
      "not shared",
    );
    await writeFile(join(setup.root, ".agentshareignore"), Buffer.from([0xff]));
    const invalidPolicy = await setup.submit([createOperation("ordinary.txt")]);
    await expect(
      prepareOwnedProposalReview(
        invalidPolicy.environmentId,
        invalidPolicy.proposalId,
        setup.options,
      ),
    ).rejects.toThrow("non-UTF-8 AgentShare ignore policy");
  });

  it("rejects raw owner hashes that differ from the redacted approved base", async () => {
    const secret = `sk-${"s".repeat(24)}`;
    const setup = await proposalFixture(`const secret = "${secret}";\n`);
    const proposal = await setup.submit();
    await expect(
      prepareOwnedProposalReview(
        proposal.environmentId,
        proposal.proposalId,
        setup.options,
      ),
    ).rejects.toThrow("raw base hash");
    await expect(
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
    ).rejects.not.toThrow(secret);
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toContain(
      secret,
    );
  });

  it("rejects text/binary secrets and noncanonical Base64 before writing", async () => {
    const setup = await proposalFixture();
    const token = "s".repeat(24);
    const bad = [
      createOperation(
        "secret.json",
        Buffer.from(`{"token":"${token}"}`),
        "application/json; charset=utf-8",
      ),
      createOperation(
        "secret.bin",
        Buffer.from(`password=${token}`, "utf16le"),
        "text/plain",
      ),
      { ...createOperation("bad.txt"), contentBase64: "c2FmZQo=\n" },
    ];
    for (const operation of bad) {
      const proposal = await setup.submit([operation]);
      await expect(
        approveOwnedProposal(
          proposal.environmentId,
          proposal.proposalId,
          undefined,
          setup.options,
        ),
      ).rejects.toThrow(/secret|integrity/u);
    }
    const oversized = await setup.submit([
      createOperation("large.txt", Buffer.alloc(100, 0x61)),
    ]);
    await expect(
      prepareOwnedProposalReview(
        oversized.environmentId,
        oversized.proposalId,
        { ...setup.options, workspaceOptions: { maxFileBytes: 50 } },
      ),
    ).rejects.toThrow(/size limit/u);
  });

  it("rejects a junction traversing outside the workspace before preview or apply", async () => {
    const setup = await proposalFixture();
    const proposal = await setup.submit();
    const outside = await mkdtemp(join(tmpdir(), "agentshare-outside-"));
    await writeFile(join(outside, "value.ts"), "outside private content");
    await fs.rename(join(setup.root, "src"), join(setup.root, "src-original"));
    await fs.symlink(outside, join(setup.root, "src"), "junction");
    await expect(
      prepareOwnedProposalReview(
        proposal.environmentId,
        proposal.proposalId,
        setup.options,
      ),
    ).rejects.toThrow("Unsafe proposal parent");
    await expect(
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
    ).rejects.toThrow("Unsafe proposal parent");
    expect(await readFile(join(outside, "value.ts"), "utf8")).toBe(
      "outside private content",
    );
  });

  it("rejects stale review digests and revisions before local changes", async () => {
    const setup = await proposalFixture();
    const proposal = await setup.submit();
    await expect(
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        { ...setup.options, reviewDigest: "wrong" },
      ),
    ).rejects.toThrow("review changed");
    await publishEnvironmentRevision(
      setup.base.capture,
      setup.shared.environment,
      setup.client,
      { statePath: setup.ownerState, preparedCapture: setup.base },
    );
    await expect(
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
    ).rejects.toThrow("no longer current");
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toContain(
      "value = 1",
    );
  });

  it("serializes concurrent approvals and publishes one revision", async () => {
    const setup = await proposalFixture();
    const proposal = await setup.submit();
    const commit = vi.spyOn(setup.client, "commitRevision");
    const outcomes = await Promise.allSettled([
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("resumes the exact pending publication without reapplying over newer local edits", async () => {
    const setup = await proposalFixture();
    const proposal = await setup.submit();
    vi.spyOn(setup.client, "commitRevision").mockRejectedValueOnce(
      new Error("interrupted commit"),
    );
    await expect(
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
    ).rejects.toThrow("interrupted commit");
    const interrupted = await findOwnedEnvironment(
      proposal.environmentId,
      setup.ownerState,
    );
    const revision = interrupted?.pendingRevision?.reservation.revisionId;
    expect(revision).toBeDefined();
    const journalPath = join(
      setup.ownerState,
      "..",
      ".agentshare-private",
      "transactions",
      `${proposal.proposalId}.enc`,
    );
    expect(
      (await readFile(journalPath)).includes(Buffer.from("export const value")),
    ).toBe(false);
    const harden = vi.spyOn(privateStore, "securePrivatePath");
    await writeFile(join(setup.root, "src/value.ts"), "newer local edit");
    const recovered = await approveOwnedProposal(
      proposal.environmentId,
      proposal.proposalId,
      undefined,
      setup.options,
    );
    expect(recovered.environment.currentRevisionId).toBe(revision);
    expect(harden).toHaveBeenCalledWith(journalPath);
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(
      "newer local edit",
    );
    expect((await loadEnvironmentState(setup.ownerState)).transactions).toEqual(
      [],
    );
  });

  it("applies create/delete operations while preserving clean binary bytes", async () => {
    const setup = await proposalFixture();
    const bytes = Buffer.from([0xff, 0xfe, 0x01, 0x02]);
    const proposal = await setup.submit([
      {
        type: "delete",
        path: "unchanged.txt",
        baseSha256: hash("approved bytes\r\n"),
      },
      createOperation("new/data.bin", bytes, "application/octet-stream"),
    ]);
    const result = await approveOwnedProposal(
      proposal.environmentId,
      proposal.proposalId,
      undefined,
      setup.options,
    );
    expect(await readFile(join(setup.root, "new/data.bin"))).toEqual(bytes);
    await expect(
      fs.lstat(join(setup.root, "unchanged.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const outbound = await readOwnedSnapshot(result.environment, setup.client);
    expect(
      outbound.snapshot.files.find((file) => file.path === "new/data.bin")
        ?.contentBase64,
    ).toBe(bytes.toString("base64"));
    expect(
      outbound.snapshot.files.some((file) => file.path === "unchanged.txt"),
    ).toBe(false);
  });

  it("recovers a prepared journal without blindly applying operations", async () => {
    const setup = await proposalFixture();
    const proposal = await setup.submit();
    vi.spyOn(environmentState, "saveTransaction").mockRejectedValueOnce(
      new Error("crash before apply"),
    );
    await expect(
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
    ).rejects.toThrow("crash before apply");
    await expect(
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
    ).rejects.toThrow("Interrupted local apply rolled back");
    expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect((await loadEnvironmentState(setup.ownerState)).transactions).toEqual(
      [],
    );
  });

  it("recovers applied-local phase from the retained overlay when publication never started", async () => {
    const setup = await proposalFixture();
    const proposal = await setup.submit();
    vi.spyOn(publication, "publishEnvironmentRevision").mockRejectedValueOnce(
      new Error("crash before publication"),
    );
    await expect(
      approveOwnedProposal(
        proposal.environmentId,
        proposal.proposalId,
        undefined,
        setup.options,
      ),
    ).rejects.toThrow("crash before publication");
    await writeFile(join(setup.root, "private-new.txt"), "never approved");
    const recovered = await approveOwnedProposal(
      proposal.environmentId,
      proposal.proposalId,
      undefined,
      setup.options,
    );
    const outbound = await readOwnedSnapshot(
      recovered.environment,
      setup.client,
    );
    expect(
      outbound.snapshot.files.some((file) => file.path === "private-new.txt"),
    ).toBe(false);
    expect((await loadEnvironmentState(setup.ownerState)).transactions).toEqual(
      [],
    );
  });

  it.each([false, true])(
    "guards rollback against concurrent edits (conflict=%s)",
    async (concurrentEdit) => {
      const setup = await proposalFixture();
      const proposal = await setup.submit([
        setup.operation,
        createOperation("arriving.txt"),
      ]);
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      let injected = false;
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        await actual.rename(from, to);
        if (!injected && String(to) === join(setup.root, "src/value.ts")) {
          injected = true;
          await writeFile(
            join(setup.root, "arriving.txt"),
            "concurrent create",
          );
          if (concurrentEdit)
            await writeFile(
              join(setup.root, "src/value.ts"),
              "concurrent edit",
            );
        }
      });
      await expect(
        approveOwnedProposal(
          proposal.environmentId,
          proposal.proposalId,
          undefined,
          setup.options,
        ),
      ).rejects.toThrow(/conflict|rollback/u);
      expect(await readFile(join(setup.root, "arriving.txt"), "utf8")).toBe(
        "concurrent create",
      );
      expect(await readFile(join(setup.root, "src/value.ts"), "utf8")).toBe(
        concurrentEdit ? "concurrent edit" : "export const value = 1;\n",
      );
      expect(
        (await loadEnvironmentState(setup.ownerState)).transactions,
      ).toHaveLength(concurrentEdit ? 1 : 0);
    },
  );
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentshare-approve-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
  return root;
}

describe("creator proposal approval", () => {
  it("changes the real workspace only after approval and publishes a new revision", async () => {
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

  it("retains proposal-linked pending state when acceptance status is interrupted", async () => {
    const now = new Date();
    const handler = createRelayHandler(new InMemoryRelayStore(), {
      now: () => now,
    });
    let failProposalAcceptance = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (
        failProposalAcceptance &&
        request.method === "POST" &&
        /\/proposals\/[^/]+\/status$/u.test(new URL(request.url).pathname)
      ) {
        return Response.json(
          {
            error: {
              code: "TEST_FAILURE",
              message: "temporary status failure",
            },
          },
          { status: 503 },
        );
      }
      return handler(request);
    };
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );
    const ownerState = join(
      await mkdtemp(join(tmpdir(), "agentshare-owner-recovery-")),
      "state-v2.json",
    );
    const readerState = join(
      await mkdtemp(join(tmpdir(), "agentshare-reader-recovery-")),
      "state-v2.json",
    );
    const cacheRoot = await mkdtemp(
      join(tmpdir(), "agentshare-reader-cache-recovery-"),
    );
    const root = await fixture();
    const capture = {
      sourceAgent: "codex" as const,
      title: "Recovery demo",
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
      "Recover interrupted approval",
      { client, statePath: readerState, cacheRoot, now: () => now },
    );

    failProposalAcceptance = true;
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
    ).rejects.toThrow("temporary status failure");
    expect(await readFile(join(root, "src", "value.ts"), "utf8")).toContain(
      "2",
    );

    const interrupted = await findOwnedEnvironment(
      shared.environment.environmentId,
      ownerState,
    );
    expect(interrupted?.pendingRevision?.proposalId).toBe(proposal.proposalId);

    failProposalAcceptance = false;
    if (interrupted === undefined)
      throw new Error("Missing interrupted owner state");
    const recovered = await resumePendingRevision(
      interrupted,
      client,
      ownerState,
    );
    expect(recovered.pendingRevision).toBeUndefined();
    const inbox = await listOwnedProposals(shared.environment.environmentId, {
      client,
      statePath: ownerState,
    });
    expect(
      inbox.find((item) => item.proposal.proposalId === proposal.proposalId)
        ?.status,
    ).toBe("accepted");
  });

  it("fails closed when the creator changed the base file after sharing", async () => {
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
