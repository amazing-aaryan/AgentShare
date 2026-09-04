type JsonObject = Record<string, unknown>;

export type HardenedCodexModelCatalog = {
  models: JsonObject[];
};

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
