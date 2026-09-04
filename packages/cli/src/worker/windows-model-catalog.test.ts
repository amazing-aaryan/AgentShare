import { describe, expect, it } from "vitest";
import * as environmentLauncher from "./environment-launcher.js";

type HardenCodexModelsCache = (
  value: unknown,
  reviewedClientVersion: string,
) => unknown;

function hardener(): HardenCodexModelsCache {
  const candidate = (
    environmentLauncher as unknown as {
      hardenCodexModelsCache?: HardenCodexModelsCache;
    }
  ).hardenCodexModelsCache;
  if (typeof candidate !== "function") {
    throw new Error("hardenCodexModelsCache is not implemented");
  }
  return candidate;
}

describe("Windows Codex model catalog isolation", () => {
  it("preserves model identity while removing local tool capabilities", () => {
    const input = {
      fetched_at: "2026-09-04T00:00:00Z",
      etag: "test-etag",
      client_version: "0.152.1",
      models: [
        {
          slug: "gpt-5.6-codex",
          display_name: "GPT-5.6 Codex",
          shell_type: "shell_command",
          apply_patch_tool_type: "freeform",
          experimental_supported_tools: ["custom_local_tool"],
          supports_search_tool: true,
          input_modalities: ["text", "image"],
          multi_agent_version: "v2",
          reasoning_levels: [{ effort: "medium" }],
          model_messages: { base_instructions: "keep me" },
        },
      ],
    };

    expect(hardener()(input, "0.152.1")).toEqual({
      models: [
        expect.objectContaining({
          slug: "gpt-5.6-codex",
          display_name: "GPT-5.6 Codex",
          shell_type: "disabled",
          apply_patch_tool_type: null,
          experimental_supported_tools: [],
          supports_search_tool: false,
          input_modalities: ["text"],
          multi_agent_version: null,
          reasoning_levels: [{ effort: "medium" }],
          model_messages: { base_instructions: "keep me" },
        }),
      ],
    });
  });

  it("fails closed for stale or malformed model caches", () => {
    expect(() => hardener()(null, "0.152.1")).toThrow(
      "Codex models cache must be a JSON object",
    );
    expect(() =>
      hardener()(
        { client_version: "0.151.0", models: [{ slug: "model" }] },
        "0.152.1",
      ),
    ).toThrow("Codex models cache version must be 0.152.1");
    expect(() =>
      hardener()({ client_version: "0.152.1", models: [] }, "0.152.1"),
    ).toThrow("Codex models cache must contain at least one model");
    expect(() =>
      hardener()({ client_version: "0.152.1", models: [{}] }, "0.152.1"),
    ).toThrow("missing a model slug");
  });
});
