import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateAgentShare, type ProcessRunner } from "./update.js";

const directories: string[] = [];
afterEach(async () => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
  }
});

describe("Windows update process invocation", () => {
  it("runs npm-cli.js through Node instead of executing npm.cmd or a shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-win-update-"));
    directories.push(directory);
    const calls: Array<{ command: string; args: string[]; inherit: boolean }> =
      [];
    const nodeExecutable = "C:\\Program Files\\nodejs\\node.exe";
    const npmCliPath =
      "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
    const cliEntrypoint =
      "C:\\Users\\creator\\AppData\\Roaming\\npm\\node_modules\\agentshare\\dist\\bin.js";
    const runner: ProcessRunner = (command, args, { inherit }) => {
      calls.push({ command, args, inherit });
      if (args.at(-1) === "--version") {
        return { status: 0, stdout: "0.1.11\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    await updateAgentShare({
      currentVersion: "0.1.10",
      cachePath: join(directory, "update-check-v1.json"),
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              tag_name: "v0.1.11",
              draft: false,
              prerelease: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      runProcess: runner,
      platform: "win32",
      nodeExecutable,
      npmCliPath,
      cliEntrypoint,
    });

    expect(calls[0]).toEqual({
      command: nodeExecutable,
      args: [
        npmCliPath,
        "install",
        "--global",
        "https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.11/agentshare-0.1.11.tgz",
      ],
      inherit: true,
    });
  });
});
