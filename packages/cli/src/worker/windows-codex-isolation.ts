import {
  copyFile,
  lstat,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  ensurePrivateDirectory,
  securePrivatePath,
} from "../environment/private-store.js";

type JsonObject = Record<string, unknown>;
type VersionTuple = readonly [major: number, minor: number, patch: number];
class ModelCacheRefreshRequired extends Error {}

export const MINIMUM_REVIEWED_NATIVE_WINDOWS_CODEX_VERSION = "0.152.1";
const MINIMUM_REVIEWED_NATIVE_WINDOWS_CODEX_VERSION_TUPLE: VersionTuple = [
  0, 152, 1,
];
// Codex can emit a harmless PATH-alias warning on stderr when CODEX_HOME is
// redirected under Windows Temp. Match the executable's exact version line
// without letting that warning make a supported runtime look unrecognized.
const STABLE_CODEX_VERSION_PATTERN = /^codex-cli\s+(\d+)\.(\d+)\.(\d+)\s*$/mu;
const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/u;

export type HardenedCodexModelCatalog = {
  models: JsonObject[];
};

export type NativeWindowsCodexIsolation = {
  canonicalCodexHome: string;
  codexHome: string;
  codexModelCatalogPath: string;
  codexSplitReadBoundary: false;
};

export function supportsReviewedNativeWindowsCodexVersion(
  output: string,
): boolean {
  return reviewedNativeWindowsCodexVersion(output) !== undefined;
}

export async function prepareNativeWindowsCodexIsolation(
  platform: NodeJS.Platform,
  versionOutput: string,
  environment: NodeJS.ProcessEnv,
  defaultHome: string,
  outputDirectory: string,
  refreshModelCache?: (privateHome: string) => Promise<void>,
): Promise<NativeWindowsCodexIsolation | undefined> {
  if (platform !== "win32") return undefined;
  const runningVersion = reviewedNativeWindowsCodexVersion(versionOutput);
  if (runningVersion === undefined) {
    throw new Error(
      `Native Windows AgentShare recipient isolation requires stable Codex CLI >= ${MINIMUM_REVIEWED_NATIVE_WINDOWS_CODEX_VERSION}; refusing older or unrecognized Windows Codex version`,
    );
  }
  const canonicalCodexHome = await resolveCodexHome(environment, defaultHome);
  // Codex may refresh models_cache.json during startup even when an explicit
  // model catalog is supplied. Give the recipient a private provider home so
  // that refreshes cannot mutate the creator's canonical home. Copy only the
  // authentication file needed for the logged-in runtime; user config,
  // sessions, skills, and model metadata stay out of the child home.
  const codexHome = await preparePrivateCodexHome(
    canonicalCodexHome,
    outputDirectory,
  );
  let codexModelCatalogPath: string;
  try {
    codexModelCatalogPath = await prepareHardenedCodexModelCatalog(
      canonicalCodexHome,
      outputDirectory,
      runningVersion,
    );
  } catch (error) {
    if (!(error instanceof ModelCacheRefreshRequired) || !refreshModelCache)
      throw error;
    await refreshModelCache(codexHome);
    // Validate and harden the newly fetched catalog with identical checks.
    // Never edit the canonical cache or relabel stale metadata as current.
    codexModelCatalogPath = await prepareHardenedCodexModelCatalog(
      codexHome,
      outputDirectory,
      runningVersion,
    );
  }
  return {
    canonicalCodexHome,
    codexHome,
    codexModelCatalogPath,
    codexSplitReadBoundary: false,
  };
}

async function preparePrivateCodexHome(
  canonicalCodexHome: string,
  outputDirectory: string,
): Promise<string> {
  const privateHome = join(outputDirectory, "codex-home");
  await ensurePrivateDirectory(privateHome);
  const canonicalAuth = join(canonicalCodexHome, "auth.json");
  const privateAuth = join(privateHome, "auth.json");
  try {
    const metadata = await lstat(canonicalAuth);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(
        "Codex authentication state must be a regular file for native Windows recipient isolation",
      );
    }
    await copyFile(canonicalAuth, privateAuth);
    await securePrivatePath(privateAuth);
  } catch (error) {
    if (isNotFound(error)) return privateHome;
    throw error;
  }
  return privateHome;
}

export async function resolveCodexHome(
  environment: NodeJS.ProcessEnv,
  defaultHome: string,
): Promise<string> {
  const configured = environment.CODEX_HOME;
  if (configured === undefined || configured.length === 0) {
    return join(defaultHome, ".codex");
  }

  let metadata;
  try {
    metadata = await stat(configured);
  } catch {
    throw new Error(
      `CODEX_HOME points to ${JSON.stringify(configured)}, but that path does not exist`,
    );
  }
  if (!metadata.isDirectory()) {
    throw new Error(
      `CODEX_HOME points to ${JSON.stringify(configured)}, but that path is not a directory`,
    );
  }
  try {
    return await realpath(configured);
  } catch (error) {
    throw new Error(
      `failed to canonicalize CODEX_HOME ${JSON.stringify(configured)}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function prepareHardenedCodexModelCatalog(
  codexHome: string,
  outputDirectory: string,
  runningVersion = MINIMUM_REVIEWED_NATIVE_WINDOWS_CODEX_VERSION,
): Promise<string> {
  const cachePath = join(codexHome, "models_cache.json");
  let serialized: string;
  try {
    serialized = await readFile(cachePath, "utf8");
  } catch {
    throw new ModelCacheRefreshRequired(
      "Codex models cache is unavailable for reviewed native Windows isolation; run Codex normally once to refresh its model metadata, then retry AgentShare",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ModelCacheRefreshRequired(
      "Codex models cache is invalid JSON; refresh Codex model metadata before retrying AgentShare",
    );
  }
  let hardened: HardenedCodexModelCatalog;
  try {
    hardened = hardenCodexModelsCache(parsed, runningVersion);
  } catch (error) {
    throw new ModelCacheRefreshRequired(
      error instanceof Error ? error.message : "Invalid Codex model metadata",
    );
  }

  await ensurePrivateDirectory(outputDirectory);
  const outputPath = join(outputDirectory, "codex-model-catalog.json");
  await writeFile(outputPath, JSON.stringify(hardened), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await securePrivatePath(outputPath);
  return outputPath;
}

export function hardenCodexModelsCache(
  value: unknown,
  runningClientVersion: string,
): HardenedCodexModelCatalog {
  if (!isJsonObject(value)) {
    throw new Error("Codex models cache must be a JSON object");
  }

  const runningVersion = parseStableVersion(runningClientVersion);
  if (runningVersion === undefined) {
    throw new Error(
      `running Codex version must be a stable version, got ${JSON.stringify(runningClientVersion)}`,
    );
  }
  if (typeof value.client_version !== "string") {
    throw new Error(
      "Codex models cache client_version must be a stable version",
    );
  }
  const cacheVersion = parseStableVersion(value.client_version);
  if (cacheVersion === undefined) {
    throw new Error(
      "Codex models cache client_version must be a stable version",
    );
  }
  if (compareVersions(cacheVersion, runningVersion) < 0) {
    throw new Error(
      `Codex models cache version ${value.client_version} is older than running Codex ${runningClientVersion}; refresh Codex model metadata before retrying AgentShare`,
    );
  }
  if (!Array.isArray(value.models) || value.models.length === 0) {
    throw new Error("Codex models cache must contain at least one model");
  }

  const models = value.models
    .map((entry, index) => validateModelEntry(entry, index))
    .filter((entry) => modelSupportsClient(entry, runningVersion))
    .map((entry) => ({
      ...entry,
      shell_type: "disabled",
      apply_patch_tool_type: null,
      experimental_supported_tools: [],
      supports_search_tool: false,
      input_modalities: ["text"],
      multi_agent_version: null,
      tool_mode: null,
      include_skills_usage_instructions: false,
      include_plugin_usage_instructions: false,
      include_apps_usage_instructions: false,
    }));

  if (models.length === 0) {
    throw new Error(
      `Codex models cache contains no models compatible with running Codex ${runningClientVersion}`,
    );
  }

  return { models };
}

function validateModelEntry(entry: unknown, index: number): JsonObject {
  if (!isJsonObject(entry)) {
    throw new Error(`Codex models cache entry ${index} must be an object`);
  }
  if (typeof entry.slug !== "string" || entry.slug.trim().length === 0) {
    throw new Error(
      `Codex models cache entry ${index} is missing a model slug`,
    );
  }
  if (
    entry.minimal_client_version !== undefined &&
    parseClientVersionTuple(entry.minimal_client_version) === undefined
  ) {
    throw new Error(
      `Codex models cache entry ${index} has invalid minimal_client_version`,
    );
  }
  return entry;
}

function modelSupportsClient(
  entry: JsonObject,
  runningVersion: VersionTuple,
): boolean {
  if (entry.minimal_client_version === undefined) return true;
  const minimum = parseClientVersionTuple(entry.minimal_client_version);
  if (minimum === undefined) return false;
  return compareVersions(minimum, runningVersion) <= 0;
}

function reviewedNativeWindowsCodexVersion(output: string): string | undefined {
  const match = STABLE_CODEX_VERSION_PATTERN.exec(output.trim());
  if (match === null) return undefined;
  const version = versionTupleFromMatch(match);
  if (
    compareVersions(
      version,
      MINIMUM_REVIEWED_NATIVE_WINDOWS_CODEX_VERSION_TUPLE,
    ) < 0
  ) {
    return undefined;
  }
  return `${version[0]}.${version[1]}.${version[2]}`;
}

function parseStableVersion(value: string): VersionTuple | undefined {
  const match = STABLE_VERSION_PATTERN.exec(value);
  return match === null ? undefined : versionTupleFromMatch(match);
}

function versionTupleFromMatch(match: RegExpExecArray): VersionTuple {
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseClientVersionTuple(value: unknown): VersionTuple | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(
      (part) => Number.isInteger(part) && typeof part === "number" && part >= 0,
    )
  ) {
    return undefined;
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function compareVersions(
  [leftMajor, leftMinor, leftPatch]: VersionTuple,
  [rightMajor, rightMinor, rightPatch]: VersionTuple,
): number {
  if (leftMajor !== rightMajor) return leftMajor - rightMajor;
  if (leftMinor !== rightMinor) return leftMinor - rightMinor;
  return leftPatch - rightPatch;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
