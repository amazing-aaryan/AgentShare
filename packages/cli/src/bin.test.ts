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
    { encoding: "utf8" },
  );
}
