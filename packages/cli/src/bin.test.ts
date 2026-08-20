import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public CLI arguments", () => {
  it("rejects the undocumented --yes approval bypass", () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("packages/cli/src/bin.ts"),
        "share",
        "--yes",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option: --yes");
  });
});
