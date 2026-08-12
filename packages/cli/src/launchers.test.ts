import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTarget, waitForTargetClose } from "./launchers.js";

const { existsSyncMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(() => true),
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", () => ({ existsSync: existsSyncMock }));

function fakeProcess(stdout: string, stderr = "") {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { end: (value?: string) => void };
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdin = { end: vi.fn() };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    child.emit("close", 0);
  });
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
  existsSyncMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("target process lifecycle", () => {
  it("waits for close so inherited stdout is fully drained", async () => {
    const child = new EventEmitter();
    let settled = false;
    const result = waitForTargetClose(child).then((exitCode) => {
      settled = true;
      return exitCode;
    });
    child.emit("exit", 0);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit("close", 0);
    await expect(result).resolves.toBe(0);
  });

  it("sanitizes child output before display and conversation storage", async () => {
    spawnMock
      .mockImplementationOnce(() => fakeProcess("2.1.210\n"))
      .mockImplementationOnce(() =>
        fakeProcess(
          "answer\u001b[31m\u202Espoof\n",
          "warning\u009b31m\u2066spoof\n",
        ),
      );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await runTarget("claude", "question");

    expect(result).toEqual({ exitCode: 0, output: "answer[31mspoof" });
    expect(stdout).toHaveBeenCalledWith("answer[31mspoof\n");
    expect(stderr).toHaveBeenCalledWith("warning31mspoof\n");
  });
});
