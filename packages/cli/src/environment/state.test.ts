import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findAttachedEnvironment,
  findOwnedEnvironmentForWorkspace,
  loadEnvironmentState,
  saveAttachedEnvironment,
  saveOwnedEnvironment,
} from "./state.js";

describe("environment state v2", () => {
  it("persists owner and recipient capabilities separately", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentshare-state-v2-"));
    const path = join(dir, "state-v2.json");
    await saveOwnedEnvironment(
      {
        environmentId: "env_12345678901234567890",
        relayOrigin: "https://relay.example",
        workspaceRoot: "/workspace/project",
        environmentMasterKey: "k".repeat(43),
        readCapability: "r".repeat(43),
        updateCapability: "u".repeat(43),
        proposalCapability: "p".repeat(43),
        inboxCapability: "i".repeat(43),
        revokeCapability: "v".repeat(43),
        proposalPrivateKey: "x".repeat(64),
        currentRevisionId: "rev_12345678901234567890",
        expiresAt: "2026-08-20T00:00:00.000Z",
        sharePolicy: {
          includeConversation: true,
          includeWorkspace: true,
          proposalsEnabled: true,
        },
      },
      path,
    );
    await saveAttachedEnvironment(
      {
        environmentId: "env_other_12345678901234567",
        relayOrigin: "https://relay.example",
        environmentMasterKey: "m".repeat(43),
        readCapability: "q".repeat(43),
        currentRevisionId: null,
        expiresAt: "2026-08-20T00:00:00.000Z",
        attachedAt: "2026-08-19T00:00:00.000Z",
        title: "Shared project",
      },
      path,
    );

    expect((await loadEnvironmentState(path)).version).toBe(2);
    expect(
      (await findOwnedEnvironmentForWorkspace("/workspace/project", path))
        ?.updateCapability,
    ).toBe("u".repeat(43));
    expect(
      (await findAttachedEnvironment("env_other_12345678901234567", path))
        ?.readCapability,
    ).toBe("q".repeat(43));
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });
});
