import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "./relay-client.js";
import {
  prepareShareDraft,
  readShareDraft,
  commitShareDraft,
  shareDraftStatus,
} from "./drafts.js";
import {
  findOwnedEnvironment,
  loadEnvironmentState,
  saveOwnedEnvironment,
  removeOwnedEnvironment,
} from "./state.js";
import { readOwnedSnapshot } from "./owned-snapshot.js";
const accept = () => Promise.resolve(true);
function required<T>(value: T | undefined | null): T {
  assert(value != null);
  return value;
}

async function fixture() {
  const workspace = await mkdtemp(
    join(tmpdir(), "agentshare-draft-workspace-"),
  );
  const stateRoot = await mkdtemp(join(tmpdir(), "agentshare-draft-state-"));
  const statePath = join(stateRoot, "state-v2.json");
  await writeFile(join(workspace, "notes.txt"), "approved bytes\n");
  const now = new Date("2026-08-27T12:00:00Z");
  const handler = createRelayHandler(new InMemoryRelayStore(), {
    now: () => now,
  });
  const fetcher = vi.fn<typeof fetch>((input, init) =>
    handler(new Request(input, init)),
  );
  const client = new EnvironmentRelayClient("http://127.0.0.1:8787", fetcher);
  const options = { statePath, now: () => now, client };
  const capture = {
    sourceAgent: "codex" as const,
    title: "Draft test",
    workspaceRoot: workspace,
    conversation: [
      {
        sequence: 0,
        role: "user" as const,
        kind: "message" as const,
        text: "Approved conversation",
        sourceId: "fixture",
      },
    ],
  };
  const prepared = await prepareShareDraft(capture, {
    ...options,
    sessionRef: "synthetic-test",
    target: { kind: "new" },
    policy: {
      includeConversation: true,
      includeWorkspace: true,
      proposalsEnabled: true,
    },
    ttlSeconds: 3600,
    relayOrigin: client.origin,
    handoffOrigin: "http://127.0.0.1:8788",
    workspaceOptions: { preferGit: false },
  });
  return {
    workspace,
    stateRoot,
    statePath,
    options,
    capture,
    prepared,
    fetcher,
  };
}

describe("immutable reviewed drafts", () => {
  it("performs no relay writes before approval and publishes only retained bytes", async () => {
    const f = await fixture();
    expect(f.fetcher).not.toHaveBeenCalled();
    await writeFile(join(f.workspace, "notes.txt"), "unreviewed change\n");
    required(f.capture.conversation[0]).text = "unreviewed conversation";
    const result = await commitShareDraft(
      f.prepared.draftId,
      f.prepared.digest,
      { ...f.options, confirm: accept },
    );
    const owned = await findOwnedEnvironment(result.environmentId, f.statePath);
    expect(owned).toBeDefined();
    const base = await readOwnedSnapshot(required(owned), f.options.client);
    expect(
      Buffer.from(
        required(base.snapshot.files[0]).contentBase64,
        "base64",
      ).toString(),
    ).toBe("approved bytes\n");
    expect(required(base.capture.conversation[0]).text).toBe(
      "Approved conversation",
    );
    expect((await loadEnvironmentState(f.statePath)).version).toBe(3);
    const again = await commitShareDraft(
      f.prepared.draftId,
      f.prepared.digest,
      {
        ...f.options,
        confirm: () =>
          Promise.reject(new Error("must not reconfirm committed draft")),
      },
    );
    expect(again.revisionId).toBe(result.revisionId);
  });
  it("rejects declined, mismatched and expired approval without remote activity", async () => {
    const f = await fixture();
    await expect(
      commitShareDraft(f.prepared.draftId, f.prepared.digest, {
        ...f.options,
        confirm: () => Promise.resolve(false),
      }),
    ).rejects.toThrow("cancelled");
    await expect(
      commitShareDraft(f.prepared.draftId, "wrong", {
        ...f.options,
        confirm: accept,
      }),
    ).rejects.toThrow("digest");
    await expect(
      commitShareDraft(f.prepared.draftId, f.prepared.digest, {
        ...f.options,
        now: () => new Date("2026-08-27T12:31:00Z"),
        confirm: accept,
      }),
    ).rejects.toThrow("expired");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("encrypts retained payload and rejects record tampering", async () => {
    const f = await fixture();
    const path = join(
      f.stateRoot,
      ".agentshare",
      "drafts-v1",
      `${f.prepared.draftId}.enc`,
    );
    const bytes = await readFile(path);
    expect(bytes.includes(Buffer.from("approved bytes"))).toBe(false);
    bytes[bytes.length - 1] = required(bytes[bytes.length - 1]) ^ 1;
    await writeFile(path, bytes);
    await expect(
      readShareDraft(f.prepared.draftId, f.prepared.digest, f.options),
    ).rejects.toThrow();
  });
  it("rejects stale owned state writers", async () => {
    const f = await fixture();
    const result = await commitShareDraft(
      f.prepared.draftId,
      f.prepared.digest,
      { ...f.options, confirm: accept },
    );
    const first = required(
      await findOwnedEnvironment(result.environmentId, f.statePath),
    );
    const stale = structuredClone(first);
    await saveOwnedEnvironment(first, f.statePath);
    await expect(saveOwnedEnvironment(stale, f.statePath)).rejects.toThrow(
      "concurrently",
    );
    expect((await shareDraftStatus(f.prepared.draftId, f.options)).status).toBe(
      "published",
    );
    await removeOwnedEnvironment(result.environmentId, f.statePath);
    delete stale.generation;
    await expect(saveOwnedEnvironment(stale, f.statePath)).rejects.toThrow(
      "resurrection",
    );
  });
  it("reconciles an interrupted remote commit using the exact pending revision", async () => {
    const f = await fixture();
    const commit = f.options.client.commitRevision.bind(f.options.client);
    const commitSpy = vi
      .spyOn(f.options.client, "commitRevision")
      .mockImplementationOnce(async (...args) => {
        await commit(...args);
        throw new Error("simulated lost commit response");
      });
    await expect(
      commitShareDraft(f.prepared.draftId, f.prepared.digest, {
        ...f.options,
        confirm: accept,
      }),
    ).rejects.toThrow("lost commit");
    const pending = required(
      (await loadEnvironmentState(f.statePath)).ownedEnvironments[0],
    );
    const expectedRevision = required(pending.pendingRevision).reservation
      .revisionId;
    const result = await commitShareDraft(
      f.prepared.draftId,
      f.prepared.digest,
      { ...f.options, confirm: accept },
    );
    expect(result.revisionId).toBe(expectedRevision);
    expect(
      (await loadEnvironmentState(f.statePath)).ownedEnvironments,
    ).toHaveLength(1);
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });
  it("binds an update to the existing expiry, not the requested new lifetime", async () => {
    const f = await fixture();
    const result = await commitShareDraft(
      f.prepared.draftId,
      f.prepared.digest,
      { ...f.options, confirm: accept },
    );
    const owned = required(
      await findOwnedEnvironment(result.environmentId, f.statePath),
    );
    const update = await prepareShareDraft(f.capture, {
      ...f.options,
      sessionRef: "synthetic-test",
      target: {
        kind: "update",
        environmentId: result.environmentId,
        expectedBaseRevisionId: result.revisionId,
      },
      policy: owned.sharePolicy,
      ttlSeconds: 259200,
      relayOrigin: owned.relayOrigin,
      handoffOrigin: "http://127.0.0.1:8788",
      workspaceOptions: { preferGit: false },
    });
    expect(update.ttlSeconds).toBe(3600);
    expect(update.existingExpiresAt).toBe(owned.expiresAt);
    expect(
      (await readShareDraft(update.draftId, update.digest, f.options))
        .existingExpiresAt,
    ).toBe(owned.expiresAt);
  });
});
