import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
  it("migrates v2 without changing capabilities and retains the original backup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentshare-state-migration-"));
    const path = join(dir, "state-v2.json");
    const attached = {
      environmentId: "env_migration",
      relayOrigin: "https://relay.example",
      environmentMasterKey: "m".repeat(43),
      readCapability: "r".repeat(43),
      currentRevisionId: null,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      attachedAt: new Date().toISOString(),
      title: "Migration fixture",
    };
    const legacy = JSON.stringify({
      version: 2,
      ownedEnvironments: [],
      attachedEnvironments: [attached],
      transactions: [],
    });
    await writeFile(path, legacy);
    await saveAttachedEnvironment(attached, path);
    expect(await readFile(`${path}.v2-backup`, "utf8")).toBe(legacy);
    expect((await loadEnvironmentState(path)).attachedEnvironments).toEqual([
      attached,
    ]);
    await saveAttachedEnvironment({ ...attached, title: "Updated" }, path);
    expect(await readFile(`${path}.v2-backup`, "utf8")).toBe(legacy);
  });
  it("persists owner and recipient capabilities separately", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentshare-state-v2-"));
    const path = join(dir, "state-v2.json");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
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
        expiresAt,
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
        expiresAt,
        attachedAt: new Date().toISOString(),
        title: "Shared project",
      },
      path,
    );

    expect((await loadEnvironmentState(path)).version).toBe(3);
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
