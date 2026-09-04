import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as windowsIsolation from "./windows-codex-isolation.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type PrepareCatalog = (
  codexHome: string,
  outputDirectory: string,
  reviewedVersion?: string,
) => Promise<string>;
type ResolveCodexHome = (
  environment: NodeJS.ProcessEnv,
  defaultHome: string,
) => Promise<string>;

function prepareCatalog(): PrepareCatalog {
  const candidate = (
    windowsIsolation as unknown as {
      prepareHardenedCodexModelCatalog?: PrepareCatalog;
    }
  ).prepareHardenedCodexModelCatalog;
  if (typeof candidate !== "function") {
    throw new Error("prepareHardenedCodexModelCatalog is not implemented");
  }
  return candidate;
}

function resolveHome(): ResolveCodexHome {
  const candidate = (
    windowsIsolation as unknown as { resolveCodexHome?: ResolveCodexHome }
  ).resolveCodexHome;
  if (typeof candidate !== "function") {
    throw new Error("resolveCodexHome is not implemented");
  }
  return candidate;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentshare-windows-codex-"));
  roots.push(root);
  return root;
}

describe("native Windows Codex catalog preparation", () => {
  it("derives a private static catalog from Codex's reviewed cache", async () => {
    const root = await temporaryRoot();
    const codexHome = join(root, "codex-home");
    const output = join(root, "private-output");
    await mkdir(codexHome, { recursive: true });
    await writeFile(
      join(codexHome, "models_cache.json"),
      JSON.stringify({
        client_version: "0.152.1",
        models: [
          {
            slug: "gpt-5.6-codex",
            display_name: "GPT-5.6 Codex",
            shell_type: "shell_command",
            apply_patch_tool_type: "freeform",
            supports_search_tool: true,
            input_modalities: ["text", "image"],
          },
        ],
      }),
      "utf8",
    );

    const path = await prepareCatalog()(codexHome, output);
    expect(path).toBe(join(output, "codex-model-catalog.json"));
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      models: [
        expect.objectContaining({
          slug: "gpt-5.6-codex",
          shell_type: "disabled",
          apply_patch_tool_type: null,
          supports_search_tool: false,
          input_modalities: ["text"],
        }),
      ],
    });
  });

  it("fails closed when the Codex cache is missing, invalid, or stale", async () => {
    const root = await temporaryRoot();
    const codexHome = join(root, "codex-home");
    const output = join(root, "private-output");
    await mkdir(codexHome, { recursive: true });

    await expect(prepareCatalog()(codexHome, output)).rejects.toThrow(
      "Codex models cache is unavailable",
    );

    await writeFile(join(codexHome, "models_cache.json"), "{invalid", "utf8");
    await expect(prepareCatalog()(codexHome, output)).rejects.toThrow(
      "Codex models cache is invalid JSON",
    );

    await writeFile(
      join(codexHome, "models_cache.json"),
      JSON.stringify({
        client_version: "0.153.0",
        models: [{ slug: "model" }],
      }),
      "utf8",
    );
    await expect(prepareCatalog()(codexHome, output)).rejects.toThrow(
      "Codex models cache version must be 0.152.1",
    );
  });

  it("matches Codex CODEX_HOME resolution semantics", async () => {
    const root = await temporaryRoot();
    const configured = join(root, "configured");
    const defaultHome = join(root, "home");
    await mkdir(configured, { recursive: true });

    await expect(
      resolveHome()({ CODEX_HOME: configured }, defaultHome),
    ).resolves.toBe(await realpath(configured));
    await expect(resolveHome()({}, defaultHome)).resolves.toBe(
      join(defaultHome, ".codex"),
    );
    await expect(
      resolveHome()({ CODEX_HOME: join(root, "missing") }, defaultHome),
    ).rejects.toThrow("CODEX_HOME points to");
  });
});
