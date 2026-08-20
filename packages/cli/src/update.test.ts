import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReleasePackageUrl,
  checkForUpdate,
  fetchLatestRelease,
  updateAgentShare,
  type ProcessRunner,
} from "./update.js";

const directories: string[] = [];
afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
  }
});

describe("AgentShare update discovery", () => {
  it("derives the immutable package URL from a validated stable tag", async () => {
    const release = await fetchLatestRelease({
      fetchImpl: releaseFetch("v0.1.11"),
    });

    expect(release).toEqual({
      version: "0.1.11",
      tag: "v0.1.11",
      packageUrl:
        "https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.11/agentshare-0.1.11.tgz",
    });
  });

  it("rejects prereleases, drafts, and malformed stable tags", async () => {
    for (const payload of [
      { tag_name: "v0.1.11-beta.1", draft: false, prerelease: false },
      { tag_name: "v0.1.11", draft: true, prerelease: false },
      { tag_name: "v0.1.11", draft: false, prerelease: true },
      { tag_name: "0.1.11", draft: false, prerelease: false },
      { tag_name: "v01.1.11", draft: false, prerelease: false },
    ]) {
      await expect(
        fetchLatestRelease({ fetchImpl: jsonFetch(payload) }),
      ).rejects.toThrow();
    }
  });

  it("rejects GitHub failures and malformed JSON", async () => {
    await expect(
      fetchLatestRelease({
        fetchImpl: async () => new Response("rate limited", { status: 403 }),
      }),
    ).rejects.toThrow("GitHub HTTP 403");
    await expect(
      fetchLatestRelease({
        fetchImpl: async () => new Response("not-json", { status: 200 }),
      }),
    ).rejects.toThrow();
  });

  it("uses a fresh 24-hour cache without making a network request", async () => {
    const directory = await temporaryDirectory();
    const cachePath = join(directory, "update-check-v1.json");
    const now = Date.parse("2026-08-20T09:00:00.000Z");
    await writeFile(
      cachePath,
      `${JSON.stringify({
        checkedAt: "2026-08-19T10:00:00.000Z",
        latestVersion: "0.1.11",
      })}\n`,
      "utf8",
    );
    let requests = 0;

    const result = await checkForUpdate({
      currentVersion: "0.1.10",
      cachePath,
      now: () => now,
      fetchImpl: async () => {
        requests += 1;
        return new Response(null, { status: 500 });
      },
    });

    expect(requests).toBe(0);
    expect(result.status).toBe("available");
  });

  it("refreshes stale or malformed cache entries and records the stable version", async () => {
    const directory = await temporaryDirectory();
    const cachePath = join(directory, "update-check-v1.json");
    await writeFile(cachePath, "{malformed", "utf8");
    let requests = 0;

    const result = await checkForUpdate({
      currentVersion: "0.1.10",
      cachePath,
      now: () => Date.parse("2026-08-20T09:00:00.000Z"),
      fetchImpl: async () => {
        requests += 1;
        return releaseResponse("v0.1.11");
      },
    });

    expect(requests).toBe(1);
    expect(result.status).toBe("available");
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual({
      checkedAt: "2026-08-20T09:00:00.000Z",
      latestVersion: "0.1.11",
    });
  });

  it("forces an explicit check even when the cache is fresh", async () => {
    const directory = await temporaryDirectory();
    const cachePath = join(directory, "update-check-v1.json");
    await writeFile(
      cachePath,
      `${JSON.stringify({
        checkedAt: "2026-08-20T08:59:00.000Z",
        latestVersion: "0.1.10",
      })}\n`,
      "utf8",
    );
    let requests = 0;

    const result = await checkForUpdate({
      currentVersion: "0.1.10",
      cachePath,
      force: true,
      now: () => Date.parse("2026-08-20T09:00:00.000Z"),
      fetchImpl: async () => {
        requests += 1;
        return releaseResponse("v0.1.11");
      },
    });

    expect(requests).toBe(1);
    expect(result.status).toBe("available");
  });

  it("never proposes a downgrade", async () => {
    const directory = await temporaryDirectory();
    const result = await checkForUpdate({
      currentVersion: "0.1.12",
      cachePath: join(directory, "update-check-v1.json"),
      force: true,
      fetchImpl: releaseFetch("v0.1.11"),
    });

    expect(result).toMatchObject({
      status: "current",
      currentVersion: "0.1.12",
      latestVersion: "0.1.11",
    });
  });
});

describe("AgentShare explicit update", () => {
  it("installs the derived immutable release, verifies the new CLI, then repairs integrations", async () => {
    const calls: Array<{ command: string; args: string[]; inherit: boolean }> =
      [];
    const runner: ProcessRunner = (command, args, { inherit }) => {
      calls.push({ command, args, inherit });
      if (args[0] === "--version") {
        return { status: 0, stdout: "0.1.11\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const directory = await temporaryDirectory();

    const result = await updateAgentShare({
      currentVersion: "0.1.10",
      cachePath: join(directory, "update-check-v1.json"),
      fetchImpl: releaseFetch("v0.1.11"),
      runProcess: runner,
      platform: "linux",
    });

    expect(result).toEqual({
      status: "updated",
      fromVersion: "0.1.10",
      toVersion: "0.1.11",
    });
    expect(calls).toEqual([
      {
        command: "npm",
        args: [
          "install",
          "--global",
          "https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.11/agentshare-0.1.11.tgz",
        ],
        inherit: true,
      },
      { command: "agentshare", args: ["--version"], inherit: false },
      { command: "agentshare", args: ["repair"], inherit: true },
    ]);
  });

  it("does not install when the current version is already newest", async () => {
    const calls: string[] = [];
    const directory = await temporaryDirectory();

    const result = await updateAgentShare({
      currentVersion: "0.1.11",
      cachePath: join(directory, "update-check-v1.json"),
      fetchImpl: releaseFetch("v0.1.11"),
      runProcess: (command) => {
        calls.push(command);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(result.status).toBe("current");
    expect(calls).toEqual([]);
  });

  it("stops before repair when npm fails or the installed version does not match", async () => {
    const directory = await temporaryDirectory();
    const packageUrl = buildReleasePackageUrl("0.1.11");

    await expect(
      updateAgentShare({
        currentVersion: "0.1.10",
        cachePath: join(directory, "npm-failure.json"),
        fetchImpl: releaseFetch("v0.1.11"),
        runProcess: (_command, args) => ({
          status: args.includes(packageUrl) ? 1 : 0,
          stdout: "",
          stderr: "npm failed",
        }),
      }),
    ).rejects.toThrow("npm install failed");

    const calls: string[][] = [];
    await expect(
      updateAgentShare({
        currentVersion: "0.1.10",
        cachePath: join(directory, "mismatch.json"),
        fetchImpl: releaseFetch("v0.1.11"),
        runProcess: (_command, args) => {
          calls.push(args);
          return args[0] === "--version"
            ? { status: 0, stdout: "0.1.10\n", stderr: "" }
            : { status: 0, stdout: "", stderr: "" };
        },
      }),
    ).rejects.toThrow("expected v0.1.11");
    expect(calls.some((args) => args[0] === "repair")).toBe(false);
  });

  it("reports a partial update when integration repair fails", async () => {
    const directory = await temporaryDirectory();

    await expect(
      updateAgentShare({
        currentVersion: "0.1.10",
        cachePath: join(directory, "repair-failure.json"),
        fetchImpl: releaseFetch("v0.1.11"),
        runProcess: (_command, args) => {
          if (args[0] === "--version")
            return { status: 0, stdout: "0.1.11\n", stderr: "" };
          if (args[0] === "repair")
            return { status: 1, stdout: "", stderr: "unmanaged integration" };
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    ).rejects.toThrow("CLI updated to v0.1.11, but integration repair failed");
  });
});

function releaseFetch(tag: string): typeof fetch {
  return async () => releaseResponse(tag);
}

function releaseResponse(tag: string): Response {
  return new Response(
    JSON.stringify({ tag_name: tag, draft: false, prerelease: false }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function jsonFetch(payload: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentshare-update-test-"));
  directories.push(directory);
  return directory;
}
