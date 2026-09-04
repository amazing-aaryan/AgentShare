import {
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

export const REVIEWED_NATIVE_WINDOWS_CODEX_VERSION = "0.152.1";

export type HardenedCodexModelCatalog = {
  models: JsonObject[];
};

export function supportsReviewedNativeWindowsCodexVersion(
  output: string,
): boolean {
  return output.trim() === `codex-cli ${REVIEWED_NATIVE_WINDOWS_CODEX_VERSION}`;
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
    );
  }
}

export async function prepareHardenedCodexModelCatalog(
  codexHome: string,
  outputDirectory: string,
  reviewedVersion = REVIEWED_NATIVE_WINDOWS_CODEX_VERSION,
): Promise<string> {
  const cachePath = join(codexHome, "models_cache.json");
  let serialized: string;
  try {
    serialized = await readFile(cachePath, "utf8");
  } catch {
    throw new Error(
      "Codex models cache is unavailable for reviewed native Windows isolation; run Codex normally once to refresh its model metadata, then retry AgentShare",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(
      "Codex models cache is invalid JSON; refresh Codex model metadata before retrying AgentShare",
    );
  }
  const hardened = hardenCodexModelsCache(parsed, reviewedVersion);

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
  reviewedClientVersion: string,
): HardenedCodexModelCatalog {
  if (!isJsonObject(value)) {
    throw new Error("Codex models cache must be a JSON object");
  }
  if (value.client_version !== reviewedClientVersion) {
    throw new Error(
      `Codex models cache version must be ${reviewedClientVersion}; refusing stale or unreviewed model metadata`,
    );
  }
  if (!Array.isArray(value.models) || value.models.length === 0) {
    throw new Error("Codex models cache must contain at least one model");
  }

  return {
    models: value.models.map((entry, index) => {
      if (!isJsonObject(entry)) {
        throw new Error(`Codex models cache entry ${index} must be an object`);
      }
      if (typeof entry.slug !== "string" || entry.slug.trim().length === 0) {
        throw new Error(
          `Codex models cache entry ${index} is missing a model slug`,
        );
      }
      return {
        ...entry,
        shell_type: "disabled",
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
        supports_search_tool: false,
        input_modalities: ["text"],
        multi_agent_version: null,
        include_skills_usage_instructions: false,
        include_plugin_usage_instructions: false,
        include_apps_usage_instructions: false,
      };
    }),
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
