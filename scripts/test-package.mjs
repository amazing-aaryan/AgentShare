import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "agentshare-package-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable");

try {
  await execute(
    process.execPath,
    [npmCli, "pack", "./packages/cli", "--pack-destination", directory],
    { cwd: resolve(".") },
  );
  const archive = (await readdir(directory)).find((file) =>
    file.endsWith(".tgz"),
  );
  if (!archive) throw new Error("npm pack did not create an archive");
  const { stdout } = await execute(
    process.execPath,
    [
      npmCli,
      "exec",
      "--yes",
      `--package=${join(directory, archive)}`,
      "--",
      "agentshare",
    ],
    { cwd: directory },
  );
  if (!stdout.includes("AgentShare")) {
    throw new Error("packed AgentShare CLI did not execute");
  }
  process.stdout.write(`Packed CLI passed: ${archive}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
