import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRelayHandler,
  InMemoryRelayStore,
  startNodeServer,
} from "@agentshare/relay";

const confirm = vi.fn<() => Promise<boolean>>();

vi.mock("./terminal.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./terminal.js")>();
  return { ...original, confirm };
});

const { shareCommand } = await import("./commands.js");

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  confirm.mockReset();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("live share reuse confirmation", () => {
  it("creates a fresh share when creator declines reuse", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-reuse-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const input = join(directory, "session.md");
    const state = join(directory, "state.json");
    await writeFile(input, "Reuse must require creator approval.", "utf8");

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

    confirm.mockResolvedValue(true);
    const first = await shareCommand({
      inputPath: input,
      relayOrigin: origin,
      ttlSeconds: 60,
      statePath: state,
    });

    confirm.mockReset();
    confirm
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const second = await shareCommand({
      inputPath: input,
      relayOrigin: origin,
      ttlSeconds: 60,
      statePath: state,
    });

    expect(second).not.toBe(first);
    expect(confirm).toHaveBeenNthCalledWith(1, "Reuse this existing live share?");
  });
});
