import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRelayHandler,
  InMemoryRelayStore,
  startNodeServer,
} from "@agentshare/relay";
import { parseShareUrl } from "@agentshare/acb";
import { shareCommand } from "./commands.js";
import { codexArgs, claudeArgs } from "./launchers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("creator and launcher", () => {
  it("shares ciphertext end to end and reuses identical live content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-test-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const input = join(directory, "session.md");
    const state = join(directory, "state.json");
    await writeFile(input, "User asked about deterministic parsing.", "utf8");

    const server = startNodeServer(
      createRelayHandler(new InMemoryRelayStore()),
      0,
    );
    await new Promise<void>((resolve) => server.once("listening", resolve));
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing test address");
    const origin = `http://127.0.0.1:${address.port}`;

    const first = await shareCommand({
      inputPath: input,
      relayOrigin: origin,
      ttlSeconds: 60,
      yes: true,
      statePath: state,
    });
    const second = await shareCommand({
      inputPath: input,
      relayOrigin: origin,
      ttlSeconds: 60,
      yes: true,
      statePath: state,
    });
    expect(second).toBe(first);
    expect(parseShareUrl(first).fragmentKey).toBeTruthy();
    expect(await readFile(state, "utf8")).toContain("revokeCapability");
  });

  it("keeps capability material out of launcher arguments", () => {
    const secret = "not-present-in-arguments";
    expect(codexArgs("C:/empty").join(" ")).not.toContain(secret);
    expect(claudeArgs().join(" ")).not.toContain(secret);
    expect(codexArgs("C:/empty")).toContain("--ephemeral");
    expect(codexArgs("C:/empty")).toContain("--ignore-user-config");
    expect(codexArgs("C:/empty").join(" ")).toContain(
      'permissions.agentshare-query.filesystem={":minimal"="deny",":workspace_roots"="deny"}',
    );
    expect(codexArgs("C:/empty").join(" ")).toContain(
      "permissions.agentshare-query.network.enabled=false",
    );
    expect(claudeArgs()).toContain("--no-session-persistence");
  });
});
