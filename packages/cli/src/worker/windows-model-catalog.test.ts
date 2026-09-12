import { describe, expect, it } from "vitest";
import * as environmentLauncher from "./environment-launcher.js";
import * as windowsIsolation from "./windows-codex-isolation.js";

type HardenCodexModelsCache = (
  value: unknown,
  runningClientVersion: string,
) => unknown;
type SupportsReviewedNativeWindowsCodexVersion = (output: string) => boolean;

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

function windowsVersionReviewer(): SupportsReviewedNativeWindowsCodexVersion {
  const candidate = (
    windowsIsolation as unknown as {
      supportsReviewedNativeWindowsCodexVersion?: SupportsReviewedNativeWindowsCodexVersion;
    }
  ).supportsReviewedNativeWindowsCodexVersion;
  if (typeof candidate !== "function") {
    throw new Error(
      "supportsReviewedNativeWindowsCodexVersion is not implemented",
    );
  }
  return candidate;
}

describe("Windows Codex model catalog isolation", () => {
  it("accepts stable native Windows Codex releases at or above the reviewed baseline", () => {
    expect(windowsVersionReviewer()("codex-cli 0.152.1")).toBe(true);
    expect(windowsVersionReviewer()("codex-cli 0.153.4")).toBe(true);
    expect(windowsVersionReviewer()("codex-cli 1.0.0")).toBe(true);
    expect(windowsVersionReviewer()("codex-cli 0.152.0")).toBe(false);
    expect(windowsVersionReviewer()("codex-cli 0.152.1-beta.1")).toBe(false);
    expect(windowsVersionReviewer()("0.153.4")).toBe(false);
  });

  it("accepts same-or-newer cache metadata, removes local tool capabilities, and filters future-only models", () => {
    const input = {
      fetched_at: "2026-09-12T00:00:00Z",
      etag: "test-etag",
      client_version: "0.154.0",
      models: [
        {
          slug: "gpt-5.6-codex",
          display_name: "GPT-5.6 Codex",
          minimal_client_version: [0, 153, 0],
          shell_type: "shell_command",
          apply_patch_tool_type: "freeform",
          experimental_supported_tools: ["custom_local_tool"],
          supports_search_tool: true,
          input_modalities: ["text", "image"],
          multi_agent_version: "v2",
          tool_mode: "code_mode_only",
          reasoning_levels: [{ effort: "medium" }],
          model_messages: { base_instructions: "keep me" },
        },
        {
          slug: "future-only-model",
          display_name: "Future only",
          minimal_client_version: [0, 155, 0],
          shell_type: "shell_command",
        },
      ],
    };

    expect(hardener()(input, "0.153.4")).toEqual({
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
          tool_mode: null,
          reasoning_levels: [{ effort: "medium" }],
          model_messages: { base_instructions: "keep me" },
        }),
      ],
    });
  });

  it("fails closed for older, malformed, empty, or incompatible model caches", () => {
    expect(() => hardener()(null, "0.153.4")).toThrow(
      "Codex models cache must be a JSON object",
    );
    expect(() =>
      hardener()(
        { client_version: "0.153.3", models: [{ slug: "model" }] },
        "0.153.4",
      ),
    ).toThrow("older than running Codex 0.153.4");
    expect(() =>
      hardener()(
        { client_version: "nightly", models: [{ slug: "model" }] },
        "0.153.4",
      ),
    ).toThrow("Codex models cache client_version must be a stable version");
    expect(() =>
      hardener()({ client_version: "0.153.4", models: [] }, "0.153.4"),
    ).toThrow("Codex models cache must contain at least one model");
    expect(() =>
      hardener()({ client_version: "0.153.4", models: [{}] }, "0.153.4"),
    ).toThrow("missing a model slug");
    expect(() =>
      hardener()(
        {
          client_version: "0.154.0",
          models: [
            {
              slug: "future-only-model",
              minimal_client_version: [0, 155, 0],
            },
          ],
        },
        "0.153.4",
      ),
    ).toThrow("no models compatible with running Codex 0.153.4");
  });
});
