import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findReusableShare, loadState, saveShare } from "./state.js";

describe("local creator state", () => {
  it("serializes concurrent updates without losing revocation credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-state-"));
    const path = join(directory, "state.json");
    try {
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          saveShare(
            {
              fingerprint: `fingerprint-${index}`,
              relayOrigin: "https://relay.example",
              shareId: `share-${index}`,
              url: `https://relay.example/s/share-${index}#r=read&k=key`,
              revokeCapability: `revoke-${index}`,
              expiresAt: "2099-01-01T00:00:00.000Z",
            },
            path,
          ),
        ),
      );
      expect((await loadState(path)).shares).toHaveLength(20);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves multiple live shares for the same fingerprint and relay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-state-"));
    const path = join(directory, "state.json");
    try {
      const common = {
        fingerprint: "same-fingerprint",
        relayOrigin: "https://relay.example",
        expiresAt: "2099-01-01T00:00:00.000Z",
      } as const;
      await saveShare(
        {
          ...common,
          shareId: "share-first",
          url: "https://handoff.example/s/share-first?relay=https%3A%2F%2Frelay.example#r=read-1&k=key-1",
          revokeCapability: "revoke-first",
        },
        path,
      );
      await saveShare(
        {
          ...common,
          shareId: "share-second",
          url: "https://handoff.example/s/share-second?relay=https%3A%2F%2Frelay.example#r=read-2&k=key-2",
          revokeCapability: "revoke-second",
        },
        path,
      );

      expect((await loadState(path)).shares).toEqual([
        expect.objectContaining({ shareId: "share-first" }),
        expect.objectContaining({ shareId: "share-second" }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reuses the most recently saved live share for identical content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-state-"));
    const path = join(directory, "state.json");
    try {
      const common = {
        fingerprint: "same-fingerprint",
        relayOrigin: "https://relay.example",
        expiresAt: "2099-01-01T00:00:00.000Z",
      } as const;
      await saveShare(
        {
          ...common,
          shareId: "share-first",
          url: "https://relay.example/s/share-first#r=read-1&k=key-1",
          revokeCapability: "revoke-first",
        },
        path,
      );
      await saveShare(
        {
          ...common,
          shareId: "share-second",
          url: "https://relay.example/s/share-second#r=read-2&k=key-2",
          revokeCapability: "revoke-second",
        },
        path,
      );

      await expect(
        findReusableShare("same-fingerprint", "https://relay.example", path),
      ).resolves.toMatchObject({ shareId: "share-second" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed capability state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-state-"));
    const path = join(directory, "state.json");
    try {
      await writeFile(path, '{"version":1,"shares":[{"url":7}]}', "utf8");
      await expect(loadState(path)).rejects.toThrow("Invalid state");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
