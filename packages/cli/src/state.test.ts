import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadState, saveShare } from "./state.js";

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
