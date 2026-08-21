import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "agentshare-package-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable");

try {
  const [rootLicense, packageLicense, rootNotice, packageNotice, cliPackage] =
    await Promise.all([
      readFile("LICENSE", "utf8"),
      readFile("packages/cli/LICENSE", "utf8"),
      readFile("NOTICE", "utf8"),
      readFile("packages/cli/NOTICE", "utf8"),
      readFile("packages/cli/package.json", "utf8").then(JSON.parse),
    ]);
  if (rootLicense !== packageLicense || rootNotice !== packageNotice) {
    throw new Error("packed license files differ from repository originals");
  }
  if (!packageNotice.includes("Copyright (c) 2025 Colin McDonnell")) {
    throw new Error("packed notice omits the bundled Zod license");
  }
  if (typeof cliPackage.version !== "string") {
    throw new Error("CLI package version is missing");
  }

  await execute(
    process.execPath,
    [npmCli, "pack", "./packages/cli", "--pack-destination", directory],
    { cwd: resolve(".") },
  );
  const archive = (await readdir(directory)).find((file) =>
    file.endsWith(".tgz"),
  );
  if (!archive) throw new Error("npm pack did not create an archive");
  const expectedArchive = `agentshare-${cliPackage.version}.tgz`;
  if (archive !== expectedArchive) {
    throw new Error(
      `packed CLI name must be ${expectedArchive}, received ${archive}`,
    );
  }
  const { stdout: manifestOutput } = await execute(
    process.execPath,
    [npmCli, "pack", "./packages/cli", "--dry-run", "--json"],
    { cwd: resolve(".") },
  );
  const packedFiles = new Set(
    JSON.parse(manifestOutput)[0].files.map(({ path }) => path),
  );
  for (const required of ["LICENSE", "NOTICE", "README.md", "dist/bin.js"]) {
    if (!packedFiles.has(required)) {
      throw new Error(`packed AgentShare CLI omits ${required}`);
    }
  }
  const { stdout } = await execute(
    process.execPath,
    [
      npmCli,
      "exec",
      "--yes",
      `--package=${join(directory, archive)}`,
      "--",
      "agentshare",
      "--version",
    ],
    { cwd: directory },
  );
  if (stdout.trim() !== cliPackage.version) {
    throw new Error(
      `packed AgentShare CLI reported ${stdout.trim() || "no version"}; expected ${cliPackage.version}`,
    );
  }

  const prefix = join(directory, "prefix");
  const home = join(directory, "home");
  await execute(
    process.execPath,
    [
      npmCli,
      "install",
      "--global",
      "--prefix",
      prefix,
      join(directory, archive),
    ],
    { cwd: directory },
  );
  const cliEntrypoint = join(
    prefix,
    "node_modules",
    "agentshare",
    "dist",
    "bin.js",
  );
  const cliEnvironment = {
    ...process.env,
    AGENTSHARE_NO_UPDATE_CHECK: "1",
    HOME: home,
    USERPROFILE: home,
  };
  const runCli = (args, selectedHome = home) =>
    execute(process.execPath, [cliEntrypoint, ...args], {
      cwd: directory,
      env: { ...cliEnvironment, HOME: selectedHome, USERPROFILE: selectedHome },
    });

  const installedVersion = await runCli(["--version"]);
  if (installedVersion.stdout.trim() !== cliPackage.version) {
    throw new Error("isolated global install reported the wrong version");
  }
  const usage = await runCli([]);
  if (!usage.stdout.includes("agentshare init|repair|remove")) {
    throw new Error("isolated global install omitted normal usage output");
  }

  await runCli(["init"]);
  const integrationFiles = [
    join(home, ".agents", "skills", "agentshare", "SKILL.md"),
    join(home, ".agents", "skills", "agentshare", "agents", "openai.yaml"),
    join(home, ".claude", "skills", "share", "SKILL.md"),
  ];
  for (const path of integrationFiles) {
    if (!(await readFile(path, "utf8")).includes("AgentShare")) {
      throw new Error(`isolated init wrote invalid integration: ${path}`);
    }
  }
  await runCli(["repair"]);
  await runCli(["remove"]);
  for (const path of integrationFiles) {
    await readFile(path, "utf8").then(
      () => {
        throw new Error(`isolated remove left integration behind: ${path}`);
      },
      (error) => {
        if (error?.code !== "ENOENT") throw error;
      },
    );
  }

  const conflictHome = join(directory, "conflict-home");
  const conflictPath = join(
    conflictHome,
    ".agents",
    "skills",
    "agentshare",
    "SKILL.md",
  );
  await mkdir(join(conflictPath, ".."), { recursive: true });
  await writeFile(conflictPath, "unmanaged integration\n", "utf8");
  await runCli(["init"], conflictHome).then(
    () => {
      throw new Error("isolated init overwrote an unmanaged integration");
    },
    (error) => {
      if (!String(error?.stderr).includes("Refusing to overwrite unmanaged")) {
        throw error;
      }
    },
  );
  if ((await readFile(conflictPath, "utf8")) !== "unmanaged integration\n") {
    throw new Error("isolated init changed an unmanaged integration");
  }
  process.stdout.write(`Packed CLI passed: ${archive}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
