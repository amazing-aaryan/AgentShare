import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageVersion = (
  JSON.parse(readFileSync(resolve("packages/cli/package.json"), "utf8")) as {
    version: string;
  }
).version;

describe("public CLI arguments", () => {
  it("prints the installed package version", () => {
    const result = runCli("--version");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${packageVersion}\n`);
    expect(result.stderr).toBe("");
  });

  it("advertises the managed update commands and v2 share controls", () => {
    const result = runCli();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("agentshare update --check");
    expect(result.stdout).toContain("agentshare update");
    expect(result.stdout).toContain("--new");
    expect(result.stdout).toContain("--ttl SECONDS");
    expect(result.stdout).toContain("--relay URL");
    expect(result.stdout).toContain("--handoff URL");
    expect(result.stdout).toContain("--session-id ID");
    expect(result.stdout).toContain("--project-root PATH");
    expect(result.stdout).toContain(
      "agentshare review --draft ID --digest SHA256",
    );
    expect(result.stdout).toContain("agentshare creator-mcp");
    expect(result.stdout).toContain("agentshare session-context");
  });

  it("exposes only exact current thread and cwd through the read-only session helper", () => {
    const result = runCliWithEnv(
      { CODEX_THREAD_ID: "test-current-thread" },
      "session-context",
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      threadId: "test-current-thread",
      cwd: process.cwd(),
    });
    const missing = runCliWithEnv({ CODEX_THREAD_ID: "" }, "session-context");
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("SESSION_REQUIRED");
  });

  it("routes doctor to creator diagnostics without claiming native approval was tested", () => {
    const result = runCli("doctor");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      nativeApproval: "requires-host-verification",
    });
  });

  it("rejects missing/duplicate identity values and non-TTY draft approval", () => {
    for (const args of [
      ["--session-id"],
      ["--project-root", "--new"],
      ["--state-path", "one", "--state-path", "two"],
    ]) {
      const result = runCli("share", "--current", "--source", "codex", ...args);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Missing value|Duplicate option/);
    }
    const review = runCli(
      "review",
      "--draft",
      "draft_fake",
      "--digest",
      "digest",
    );
    expect(review.status).toBe(1);
    expect(review.stderr).toContain("requires a TTY");
    expect(runCli("review", "--yes").stderr).toContain("Unknown option: --yes");
    expect(runCli("copy-environment").stderr).toContain(
      "Missing --environment",
    );
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

  it("rejects invalid ttl before adapter or network work", () => {
    const result = runCli(
      "share",
      "--current",
      "--source",
      "codex",
      "--ttl",
      "0",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--ttl must be an integer between 1 and 259200 seconds",
    );
  });
});

function runCli(...args: string[]) {
  return runCliWithEnv({}, ...args);
}

function runCliWithEnv(env: Record<string, string>, ...args: string[]) {
  return spawnSync(
    process.execPath,
    [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("packages/cli/src/bin.ts"),
      ...args,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ...env, AGENTSHARE_NO_UPDATE_CHECK: "1" },
    },
  );
}
