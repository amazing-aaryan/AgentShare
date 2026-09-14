import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resumePendingRevision } from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import {
  loadEnvironmentState,
  saveAttachedEnvironment,
  saveOwnedEnvironment,
  type OwnedEnvironment,
} from "../environment/state.js";
import {
  latestAttachedEnvironment,
  repairOwnedEnvironmentPublications,
  revokeOwnedEnvironment,
} from "./runtime-v2.js";

vi.mock("../environment/publication.js", () => ({
  resumePendingRevision: vi.fn(),
}));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(resumePendingRevision).mockReset();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentshare-scoped-runtime-"));
  roots.push(root);
  const statePath = join(root, "state-v2.json");
  const owned = (suffix: string): OwnedEnvironment => ({
    environmentId: `env_${suffix}`,
    relayOrigin: `https://relay-${suffix}.example`,
    workspaceRoot: join(root, suffix),
    environmentMasterKey: "k".repeat(43),
    readCapability: "r".repeat(43),
    updateCapability: "u".repeat(43),
    inboxCapability: "i".repeat(43),
    revokeCapability: "v".repeat(43),
    proposalPrivateKey: "x".repeat(64),
    currentRevisionId: null,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    sharePolicy: {
      includeConversation: true,
      includeWorkspace: true,
      proposalsEnabled: true,
    },
    pendingRevision: {
      reservation: {
        revisionId: `rev_${suffix}`,
        manifest: { ciphertextSha256: "a".repeat(64), ciphertextBytes: 16 },
        blobs: [],
      },
      manifestBase64: "AA==",
      blobs: [],
    },
  });
  const first = owned("first");
  const second = owned("second");
  await saveOwnedEnvironment(first, statePath);
  await saveOwnedEnvironment(second, statePath);
  return { statePath, first, second };
}

describe("scoped environment management", () => {
  it("requires a named recovery target and uses only its saved relay", async () => {
    const { statePath, first } = await fixture();
    await expect(repairOwnedEnvironmentPublications(statePath)).rejects.toThrow(
      "Scoped recovery",
    );
    expect(resumePendingRevision).not.toHaveBeenCalled();
    vi.mocked(resumePendingRevision).mockImplementation((owned) =>
      Promise.resolve(owned),
    );
    expect(
      await repairOwnedEnvironmentPublications(statePath, first.environmentId),
    ).toBe(1);
    expect(resumePendingRevision).toHaveBeenCalledTimes(1);
    const call = vi.mocked(resumePendingRevision).mock.calls[0];
    if (call === undefined) throw new Error("Expected recovery call");
    expect(call[0].environmentId).toBe(first.environmentId);
    expect(call[1].origin).toBe(first.relayOrigin);
    expect(call[2]).toBe(statePath);
    await expect(
      repairOwnedEnvironmentPublications(statePath, "unknown"),
    ).rejects.toThrow("not owned");
  });

  it("revokes only the named environment without capture, preserving others", async () => {
    const { statePath, first, second } = await fixture();
    const revoke = vi
      .spyOn(EnvironmentRelayClient.prototype, "revoke")
      .mockResolvedValue({
        protocolVersion: "agentshare-environment-relay-v2",
        environmentId: first.environmentId,
        createdAt: new Date().toISOString(),
        expiresAt: first.expiresAt,
        status: "revoked",
        currentRevisionId: null,
        currentRevision: null,
        limits: { maxCiphertextBytes: 1000, maxTtlSeconds: 3600 },
      });
    await revokeOwnedEnvironment(first.environmentId, statePath);
    expect(revoke).toHaveBeenCalledExactlyOnceWith(
      first.environmentId,
      first.revokeCapability,
    );
    expect(
      (await loadEnvironmentState(statePath)).ownedEnvironments.map(
        (item) => item.environmentId,
      ),
    ).toEqual([second.environmentId]);
  });

  it("does not silently choose the newest attached environment", async () => {
    const { statePath, first, second } = await fixture();
    for (const item of [first, second]) {
      await saveAttachedEnvironment(
        {
          environmentId: item.environmentId,
          relayOrigin: item.relayOrigin,
          environmentMasterKey: item.environmentMasterKey,
          readCapability: item.readCapability,
          currentRevisionId: item.currentRevisionId,
          expiresAt: item.expiresAt,
          attachedAt: new Date().toISOString(),
          title: "fixture",
        },
        statePath,
      );
    }
    await expect(latestAttachedEnvironment(statePath)).rejects.toThrow(
      "explicit --environment",
    );
  });
});
