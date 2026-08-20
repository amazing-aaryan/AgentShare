import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public CLI arguments", () => {
  it("prints the installed package version", () => {
    const result = runCli("--version");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0.1.10\n");
    expect(result.stderr).toBe("");
  });

  it("advertises the managed update commands", () => {
    const result = runCli();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("agentshare update --check");
    expect(result.stdout).toContain("agentshare update");
  });

  it("rejects unknown update options before any network request", () => {
    const result = runCli("update", "--bogus");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option: --bogus");
  });

  it("rejects the undocumented --yes approval bypass", () => {
    const result = runCli("share", "--yes");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option: --yes");
  });
});

function runCli(...args: string[]) {
  return spawnSync(
    process.execPath,
    [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("packages/cli/src/bin.ts"),
      ...args,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, AGENTSHARE_NO_UPDATE_CHECK: "1" },
    },
  );
}
