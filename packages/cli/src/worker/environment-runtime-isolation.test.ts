import { existsSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  codexEnvironmentArgs,
  runEnvironmentTarget,
} from "./environment-launcher.js";

const { spawnMock, prepareMock, captureMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  prepareMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));
vi.mock("../launchers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../launchers.js")>()),
  verifyTarget: vi.fn().mockResolvedValue(undefined),
  resolveAgentExecutable: () => ({ command: "codex", prefixArgs: [] }),
  discoverUserSkills: vi.fn().mockResolvedValue([]),
  captureProcess: captureMock,
  waitForTargetClose: vi.fn().mockResolvedValue(0),
}));
vi.mock("./windows-codex-isolation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./windows-codex-isolation.js")>()),
  prepareNativeWindowsCodexIsolation: prepareMock,
}));
vi.mock("../environment/private-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../environment/private-store.js")>()),
  ensurePrivateDirectory: vi.fn().mockResolvedValue(undefined),
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const catalog = "C:\\synthetic\\private\\codex-model-catalog.json";
const codexHome = "C:\\synthetic\\Codex home";

function platform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

beforeEach(() => {
  platform("win32");
  spawnMock.mockReset();
  prepareMock.mockReset();
  captureMock.mockReset();
  prepareMock.mockResolvedValue({
    codexHome,
    codexModelCatalogPath: catalog,
    codexSplitReadBoundary: false,
  });
  captureMock.mockImplementation((_command: string, args: string[]) =>
    Promise.resolve(args.includes("--version") ? "codex-cli 0.152.1" : "mcp"),
  );
  spawnMock.mockReturnValue({
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: { end: vi.fn() },
  });
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  if (originalPlatform !== undefined) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
  vi.restoreAllMocks();
});

describe("recipient runtime isolation selection", () => {
  it("prepares the native profile before spawn and preserves provider home", async () => {
    const result = await runEnvironmentTarget("codex", "env_test", "read");
    expect(prepareMock).toHaveBeenCalledOnce();
    expect(prepareMock.mock.calls[0]?.slice(0, 2)).toEqual([
      "win32",
      "codex-cli 0.152.1",
    ]);
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain(`model_catalog_json=${JSON.stringify(catalog)}`);
    expect(args).not.toContain('default_permissions="agentshare-query"');
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain("features.shell_tool=false");
    expect(args).toContain("features.unified_exec=false");
    expect(args).toContain("mcp_servers.agentshare.required=true");
    const options = spawnMock.mock.calls[0]?.[2] as {
      cwd: string;
      env: Record<string, string>;
    };
    expect(options.env.CODEX_HOME).toBe(codexHome);
    expect(options.env).not.toHaveProperty("AGENTSHARE_MCP_RECEIPT_PATH");
    expect(options.env).not.toHaveProperty("AGENTSHARE_MCP_RUN_ID");
    expect(existsSync(options.cwd)).toBe(false);
    const privateDirectory = prepareMock.mock.calls[0]?.[4] as string;
    expect(existsSync(privateDirectory)).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.receipts).toEqual([]);
  });

  it("never spawns when native isolation preparation fails", async () => {
    prepareMock.mockRejectedValue(new Error("unreviewed native runtime"));
    await expect(
      runEnvironmentTarget("codex", "env_test", "read"),
    ).rejects.toThrow("unreviewed native runtime");
    expect(spawnMock).not.toHaveBeenCalled();
    const privateDirectory = prepareMock.mock.calls[0]?.[4] as string;
    expect(existsSync(privateDirectory)).toBe(false);
  });

  it.each(["linux", "darwin"] as const)(
    "does not allow caller options to remove the %s read boundary",
    async (hostPlatform) => {
      platform(hostPlatform);
      await runEnvironmentTarget("codex", "env_test", "read", {
        codexSplitReadBoundary: false,
        codexModelCatalogPath: catalog,
      });
      expect(prepareMock).not.toHaveBeenCalled();
      const args = spawnMock.mock.calls[0]?.[1] as string[];
      expect(args).toContain('default_permissions="agentshare-query"');
      expect(args.some((arg) => arg.startsWith("model_catalog_json="))).toBe(
        false,
      );
    },
  );

  it("refuses a split-read override without a hardened catalog", () => {
    expect(() =>
      codexEnvironmentArgs("/tmp/empty", "env_test", "node", "cli.js", {
        codexSplitReadBoundary: false,
      }),
    ).toThrow("requires a hardened model catalog");
  });
});
