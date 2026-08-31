import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureProcess,
  runTarget,
  supportsReviewedTargetVersion,
  supportsReviewedEnvironmentTargetVersion,
  waitForTargetClose,
} from "./launchers.js";

const CLAUDE_HELP = [
  "  -p, --print  Print mode",
  "  --no-session-persistence  Ephemeral",
  "  --tools <tools>  Tools",
  "  --strict-mcp-config  Strict MCP",
  "  --mcp-config <config>  MCP config",
  "  --setting-sources <sources>  Settings",
  "  --disable-slash-commands  No skills",
  "  --no-chrome  No browser",
  "  --permission-mode <mode>  Permissions",
].join("\n");

const CODEX_INCOMPLETE_HELP = [
  "  -c, --config <key=value>  Config",
  "  -C, --cd <dir>  Working root",
  "  --ephemeral  Ephemeral",
].join("\n");

const { existsSyncMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(() => true),
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", () => ({ existsSync: existsSyncMock }));

function fakeProcess(stdout: string, stderr = "") {
  const child = fakeHangingProcess();
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    child.emit("close", 0);
  });
  return child;
}

function fakeHangingProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { end: (value?: string) => void };
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  child.stdin = { end: vi.fn() };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  Object.assign(child, { kill: vi.fn(), pid: 12345 });
  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
  existsSyncMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("target process lifecycle", () => {
  it("pins v2 Codex MCP to 0.147.0 without changing general Codex support", () => {
    for (const version of ["0.145.0", "0.146.0"]) {
      expect(
        supportsReviewedTargetVersion("codex", `codex-cli ${version}`),
      ).toBe(true);
      expect(
        supportsReviewedEnvironmentTargetVersion(
          "codex",
          `codex-cli ${version}`,
        ),
      ).toBe(false);
    }
    expect(
      supportsReviewedEnvironmentTargetVersion("codex", "codex-cli 0.147.0"),
    ).toBe(true);
    expect(
      supportsReviewedEnvironmentTargetVersion("codex", "codex-cli 0.148.0"),
    ).toBe(false);
  });

  it("allows capability-compatible Codex releases while keeping Claude reviewed", () => {
    expect(supportsReviewedTargetVersion("codex", "codex-cli 0.147.0")).toBe(
      true,
    );
    expect(supportsReviewedTargetVersion("codex", "codex-cli 0.149.0")).toBe(
      true,
    );
    expect(supportsReviewedTargetVersion("codex", "codex-cli 99.4.7-beta.1")).toBe(
      true,
    );
    expect(supportsReviewedTargetVersion("codex", "codex-cli 0.144.9")).toBe(
      false,
    );
    expect(
      supportsReviewedTargetVersion("claude", "2.1.238 (Claude Code)"),
    ).toBe(true);
    expect(
      supportsReviewedTargetVersion("claude", "2.1.239 (Claude Code)"),
    ).toBe(false);
  });

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
      .mockImplementationOnce(() => fakeProcess("2.1.231 (Claude Code)\n"))
      .mockImplementationOnce(() => fakeProcess(CLAUDE_HELP))
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

  it("fails closed before launch when a required isolation control is absent", async () => {
    spawnMock
      .mockImplementationOnce(() => fakeProcess("codex-cli 0.147.0\n"))
      .mockImplementationOnce(() => fakeProcess(CODEX_INCOMPLETE_HELP));

    await expect(runTarget("codex", "question")).rejects.toThrow(
      "lacks required isolation controls",
    );
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a too-old Codex version without running its help command", async () => {
    spawnMock.mockImplementationOnce(() =>
      fakeProcess("codex-cli 0.144.9\n"),
    );

    await expect(runTarget("codex", "question")).rejects.toThrow(
      "requires Codex CLI >= 0.145.0",
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized probe output without waiting for close", async () => {
    const child = fakeHangingProcess();
    spawnMock.mockReturnValueOnce(child);
    queueMicrotask(() => child.stdout.write("12345"));

    await expect(
      captureProcess("claude", ["--version"], 1_000, 4),
    ).rejects.toThrow("exceeded 4 bytes");
    expect(child.stdout.destroyed).toBe(true);
  });

  it("rejects a probe deadline even when target never closes", async () => {
    vi.useFakeTimers();
    const child = fakeHangingProcess();
    spawnMock.mockReturnValueOnce(child);
    const result = captureProcess("claude", ["--version"], 10, 1_000);
    const rejection = expect(result).rejects.toThrow("timed out after 10 ms");

    await vi.advanceTimersByTimeAsync(11);
    await rejection;
  });
});
