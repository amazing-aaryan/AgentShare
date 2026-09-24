import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AGENTSHARE_VERSION } from "./version.js";

const RELEASE_API_URL =
  "https://api.github.com/repos/amazing-aaryan/AgentShare/releases/latest";
const RELEASE_DOWNLOAD_BASE =
  "https://github.com/amazing-aaryan/AgentShare/releases/download";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;

export type ReleaseInfo = {
  version: string;
  tag: string;
  packageUrl: string;
};

export type UpdateCheck =
  | {
      status: "current";
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: "available";
      currentVersion: string;
      latestVersion: string;
      packageUrl: string;
    };

export type UpdateResult =
  | UpdateCheck
  | {
      status: "updated";
      fromVersion: string;
      toVersion: string;
    };

export type ProcessRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type ProcessRunner = (
  command: string,
  args: string[],
  options: { inherit: boolean },
) => ProcessRunResult;

type UpdateCache = {
  checkedAt: string;
  latestVersion: string;
};

type CheckOptions = {
  currentVersion?: string;
  cachePath?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

type UpdateOptions = CheckOptions & {
  runProcess?: ProcessRunner;
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  npmCliPath?: string;
  cliEntrypoint?: string;
};

type PinnedInstallOptions = Pick<
  UpdateOptions,
  "runProcess" | "platform" | "nodeExecutable" | "npmCliPath"
> & { version?: string; cliEntrypoint?: string };

export function pinnedGlobalCliInstalled(
  options: PinnedInstallOptions = {},
): boolean {
  const version = options.version ?? AGENTSHARE_VERSION;
  let npm: { command: string; args: string[] };
  try {
    npm = resolveNpmInvocation({
      platform: options.platform ?? process.platform,
      nodeExecutable: options.nodeExecutable ?? process.execPath,
      ...(options.npmCliPath === undefined
        ? {}
        : { npmCliPath: options.npmCliPath }),
    });
  } catch {
    return false;
  }
  const result = (options.runProcess ?? defaultProcessRunner)(
    npm.command,
    [...npm.args, "ls", "--global", "--json", "--depth=0", "agentshare"],
    { inherit: false },
  );
  if (!processSucceeded(result)) return false;
  try {
    const payload = JSON.parse(result.stdout) as {
      dependencies?: { agentshare?: { version?: unknown } };
    };
    if (payload.dependencies?.agentshare?.version !== version) return false;
    const root = (options.runProcess ?? defaultProcessRunner)(
      npm.command,
      [...npm.args, "root", "--global"],
      { inherit: false },
    );
    if (!processSucceeded(root) || root.stdout.trim().length === 0)
      return false;
    const running = options.cliEntrypoint ?? process.argv[1];
    if (running === undefined) return false;
    const installed = join(root.stdout.trim(), "agentshare", "dist", "bin.js");
    const digest = (path: string) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    return digest(running) === digest(installed);
  } catch {
    return false;
  }
}

/** Called only after native first-use consent. */
export function installPinnedGlobalCli(
  options: PinnedInstallOptions = {},
): void {
  const version = options.version ?? AGENTSHARE_VERSION;
  const npm = resolveNpmInvocation({
    platform: options.platform ?? process.platform,
    nodeExecutable: options.nodeExecutable ?? process.execPath,
    ...(options.npmCliPath === undefined
      ? {}
      : { npmCliPath: options.npmCliPath }),
  });
  const runProcess = options.runProcess ?? defaultProcessRunner;
  const install = runProcess(
    npm.command,
    [
      ...npm.args,
      "install",
      "--global",
      "--ignore-scripts",
      buildReleasePackageUrl(version),
    ],
    { inherit: false },
  );
  assertProcessSucceeded(install, "Pinned AgentShare CLI installation failed");
  if (!pinnedGlobalCliInstalled({ ...options, runProcess, version }))
    throw new Error("Pinned AgentShare CLI verification failed");
}

export function defaultUpdateCachePath(): string {
  return join(homedir(), ".agentshare", "update-check-v1.json");
}

export function buildReleasePackageUrl(version: string): string {
  parseStableVersion(version);
  return `${RELEASE_DOWNLOAD_BASE}/v${version}/agentshare-${version}.tgz`;
}

export async function fetchLatestRelease(
  options: Pick<CheckOptions, "fetchImpl" | "timeoutMs"> = {},
): Promise<ReleaseInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetchImpl(RELEASE_API_URL, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `AgentShare/${AGENTSHARE_VERSION}`,
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "Unable to check for AgentShare updates (GitHub HTTP 403). GitHub may be rate-limiting update checks; try again later. Set AGENTSHARE_NO_UPDATE_CHECK=1 to disable passive checks.",
      );
    }
    throw new Error(
      `Unable to check for AgentShare updates (GitHub HTTP ${response.status})`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Latest AgentShare release metadata is invalid");
  }
  const release = payload as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false) {
    throw new Error(
      "Latest AgentShare release is not a stable published release",
    );
  }
  if (typeof release.tag_name !== "string") {
    throw new Error("Latest AgentShare release tag is missing");
  }
  const version = versionFromTag(release.tag_name);
  return {
    version,
    tag: release.tag_name,
    packageUrl: buildReleasePackageUrl(version),
  };
}

export async function checkForUpdate(
  options: CheckOptions = {},
): Promise<UpdateCheck> {
  const currentVersion = options.currentVersion ?? AGENTSHARE_VERSION;
  parseStableVersion(currentVersion);
  const cachePath = options.cachePath ?? defaultUpdateCachePath();
  const now = options.now ?? Date.now;

  if (!options.force) {
    const cache = await loadUpdateCache(cachePath);
    if (cache !== undefined && isFresh(cache, now())) {
      return classifyVersions(currentVersion, cache.latestVersion);
    }
  }

  const release = await fetchLatestRelease({
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });
  await saveUpdateCache(cachePath, {
    checkedAt: new Date(now()).toISOString(),
    latestVersion: release.version,
  }).catch(() => undefined);
  return classifyVersions(currentVersion, release.version, release.packageUrl);
}

export async function updateAgentShare(
  options: UpdateOptions = {},
): Promise<UpdateResult> {
  const currentVersion = options.currentVersion ?? AGENTSHARE_VERSION;
  const check = await checkForUpdate({
    currentVersion,
    ...(options.cachePath === undefined
      ? {}
      : { cachePath: options.cachePath }),
    force: true,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });
  if (check.status === "current") return check;

  const runProcess = options.runProcess ?? defaultProcessRunner;
  const platform = options.platform ?? process.platform;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const npm = resolveNpmInvocation({
    platform,
    nodeExecutable,
    ...(options.npmCliPath === undefined
      ? {}
      : { npmCliPath: options.npmCliPath }),
  });
  const install = runProcess(
    npm.command,
    [...npm.args, "install", "--global", check.packageUrl],
    { inherit: true },
  );
  assertProcessSucceeded(install, "npm install failed");

  const cliEntrypoint = options.cliEntrypoint ?? process.argv[1];
  if (cliEntrypoint === undefined) {
    throw new Error(
      `AgentShare CLI installed v${check.latestVersion}, but the running CLI path is unavailable for verification`,
    );
  }

  const verification = runProcess(
    nodeExecutable,
    [cliEntrypoint, "--version"],
    { inherit: false },
  );
  assertProcessSucceeded(
    verification,
    "Updated AgentShare CLI verification failed",
  );
  if (verification.stdout.trim() !== check.latestVersion) {
    throw new Error(
      `AgentShare update verification expected v${check.latestVersion} but found ${verification.stdout.trim() || "no version output"}`,
    );
  }

  const repair = runProcess(nodeExecutable, [cliEntrypoint, "repair"], {
    inherit: true,
  });
  if (!processSucceeded(repair)) {
    throw new Error(
      `AgentShare CLI updated to v${check.latestVersion}, but integration repair failed. Run \`agentshare repair\` after resolving the reported integration conflict.`,
    );
  }

  return {
    status: "updated",
    fromVersion: currentVersion,
    toVersion: check.latestVersion,
  };
}

export async function passiveUpdateNotice(
  options: CheckOptions & { env?: NodeJS.ProcessEnv } = {},
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  if (env.AGENTSHARE_NO_UPDATE_CHECK === "1") return undefined;
  try {
    const check = await checkForUpdate({
      ...(options.currentVersion === undefined
        ? {}
        : { currentVersion: options.currentVersion }),
      ...(options.cachePath === undefined
        ? {}
        : { cachePath: options.cachePath }),
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
      ...(options.now === undefined ? {} : { now: options.now }),
      timeoutMs: options.timeoutMs ?? 2_500,
    });
    if (check.status === "available") {
      return `Update available: AgentShare v${check.latestVersion} (installed v${check.currentVersion}). Run \`agentshare update\` to install it.`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function resolveNpmInvocation(options: {
  platform: NodeJS.Platform;
  nodeExecutable: string;
  npmCliPath?: string;
}): { command: string; args: string[] } {
  if (options.platform !== "win32") {
    return { command: "npm", args: [] };
  }

  const npmExecPath = process.env.npm_execpath;
  let discoveredNpmCliPath: string | undefined;
  if (npmExecPath !== undefined && existsSync(npmExecPath)) {
    discoveredNpmCliPath = npmExecPath;
  }
  const npmCliPath =
    options.npmCliPath ??
    discoveredNpmCliPath ??
    join(
      dirname(options.nodeExecutable),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
  if (options.npmCliPath === undefined && !existsSync(npmCliPath)) {
    throw new Error(
      "Unable to locate npm-cli.js for a no-shell update. Run the documented immutable npm install command manually.",
    );
  }
  return { command: options.nodeExecutable, args: [npmCliPath] };
}

function versionFromTag(tag: string): string {
  if (!tag.startsWith("v")) {
    throw new Error("Latest AgentShare release has invalid stable tag");
  }
  const version = tag.slice(1);
  parseStableVersion(version);
  return version;
}

function parseStableVersion(
  version: string,
): readonly [bigint, bigint, bigint] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  const major = match?.[1];
  const minor = match?.[2];
  const patch = match?.[3];
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error(`Invalid stable AgentShare version: ${version}`);
  }
  return [BigInt(major), BigInt(minor), BigInt(patch)];
}

function compareVersions(left: string, right: string): number {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  for (let index = 0; index < a.length; index += 1) {
    const leftPart = a[index];
    const rightPart = b[index];
    if (leftPart === undefined || rightPart === undefined) continue;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

function classifyVersions(
  currentVersion: string,
  latestVersion: string,
  packageUrl = buildReleasePackageUrl(latestVersion),
): UpdateCheck {
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return { status: "current", currentVersion, latestVersion };
  }
  return {
    status: "available",
    currentVersion,
    latestVersion,
    packageUrl,
  };
}

async function loadUpdateCache(path: string): Promise<UpdateCache | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const cache = parsed as Record<string, unknown>;
    if (
      typeof cache.checkedAt !== "string" ||
      typeof cache.latestVersion !== "string"
    ) {
      return undefined;
    }
    if (!Number.isFinite(Date.parse(cache.checkedAt))) return undefined;
    parseStableVersion(cache.latestVersion);
    return {
      checkedAt: cache.checkedAt,
      latestVersion: cache.latestVersion,
    };
  } catch {
    return undefined;
  }
}

function isFresh(cache: UpdateCache, now: number): boolean {
  const age = now - Date.parse(cache.checkedAt);
  return age >= 0 && age < UPDATE_CHECK_INTERVAL_MS;
}

async function saveUpdateCache(
  path: string,
  cache: UpdateCache,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function defaultProcessRunner(
  command: string,
  args: string[],
  options: { inherit: boolean },
): ProcessRunResult {
  const result = spawnSync(
    command,
    args,
    options.inherit
      ? { stdio: "inherit", timeout: 120_000 }
      : { encoding: "utf8", timeout: 120_000, maxBuffer: 1_048_576 },
  );
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

function processSucceeded(result: ProcessRunResult): boolean {
  return result.error === undefined && result.status === 0;
}

function assertProcessSucceeded(
  result: ProcessRunResult,
  message: string,
): void {
  if (result.error !== undefined) {
    throw new Error(`${message}: ${result.error.message}`);
  }
  if (result.status !== 0) throw new Error(message);
}
