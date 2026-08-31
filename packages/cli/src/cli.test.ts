import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRelayHandler,
  InMemoryRelayStore,
  startNodeServer,
} from "@agentshare/relay";
import { parseShareUrl } from "@agentshare/acb";
import { openShare, shareCommand } from "./commands.js";
import {
  codexArgs,
  claudeArgs,
  missingTargetCapabilities,
  supportsReviewedTargetVersion,
  recognizesTargetVersion,
  unsupportedTargetCapabilitiesMessage,
  unsupportedTargetVersionMessage,
} from "./launchers.js";
import { loadState } from "./state.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("creator and launcher", () => {
  it("shares ciphertext end to end and reuses identical live content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-test-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const input = join(directory, "session.md");
    const state = join(directory, "state.json");
    await writeFile(input, "User asked about deterministic parsing.", "utf8");

    const server = startNodeServer(
      createRelayHandler(new InMemoryRelayStore()),
      0,
    );
    await new Promise<void>((resolve) => server.once("listening", resolve));
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing test address");
    const origin = `http://127.0.0.1:${address.port}`;

    const first = await shareCommand({
      inputPath: input,
      relayOrigin: origin,
      ttlSeconds: 60,
      assumeApproved: true,
      statePath: state,
    });
    const second = await shareCommand({
      inputPath: input,
      relayOrigin: origin,
      ttlSeconds: 60,
      assumeApproved: true,
      statePath: state,
    });
    expect(second).toBe(first);
    expect(parseShareUrl(first).fragmentKey).toBeTruthy();
    expect(await readFile(state, "utf8")).toContain("revokeCapability");
  });

  it("keeps capability material out of launcher arguments", () => {
    const secret = "not-present-in-arguments";
    expect(codexArgs("C:/empty").join(" ")).not.toContain(secret);
    expect(claudeArgs().join(" ")).not.toContain(secret);
    expect(codexArgs("C:/empty")).toContain("--ephemeral");
    expect(codexArgs("C:/empty")).toContain("--ignore-user-config");
    expect(codexArgs("C:/empty").join(" ")).toContain(
      'permissions.agentshare-query.filesystem={":minimal"="deny",":workspace_roots"="deny"}',
    );
    expect(codexArgs("C:/empty").join(" ")).toContain(
      "permissions.agentshare-query.network.enabled=false",
    );
    expect(codexArgs("C:/empty").join(" ")).toContain(
      "features.shell_tool=false",
    );
    expect(codexArgs("C:/empty").join(" ")).toContain(
      "features.unified_exec=false",
    );
    expect(codexArgs("C:/empty").join(" ")).toContain(
      "features.apply_patch_freeform=false",
    );
    expect(claudeArgs()).toContain("--no-session-persistence");
    expect(recognizesTargetVersion("codex", "codex-cli 0.145.0")).toBe(true);
    expect(recognizesTargetVersion("claude", "2.1.210 (Claude Code)")).toBe(
      true,
    );
    expect(recognizesTargetVersion("claude", "2.1.223 (Claude Code)")).toBe(
      true,
    );
    expect(recognizesTargetVersion("claude", "2.1.231 (Claude Code)")).toBe(
      true,
    );
    expect(recognizesTargetVersion("codex", "codex-cli 0.146.0")).toBe(true);
    expect(recognizesTargetVersion("codex", "codex-cli 99.4.7-beta.1")).toBe(
      true,
    );
    expect(recognizesTargetVersion("claude", "2.1.211 (Claude Code)")).toBe(
      true,
    );
    expect(
      recognizesTargetVersion("claude", "99.4.7-beta.1 (Claude Code)"),
    ).toBe(true);
    expect(recognizesTargetVersion("claude", "not-claude 2.1.231")).toBe(false);
    expect(
      recognizesTargetVersion("claude", "2.1.231 (Claude Code) forged"),
    ).toBe(false);
    expect(
      supportsReviewedTargetVersion("claude", "2.1.231 (Claude Code)"),
    ).toBe(true);
    expect(
      supportsReviewedTargetVersion("claude", "2.1.232 (Claude Code)"),
    ).toBe(false);
    expect(supportsReviewedTargetVersion("codex", "codex-cli 0.999.0")).toBe(
      true,
    );
    expect(
      unsupportedTargetVersionMessage("claude", "not-claude 2.1.232"),
    ).toBe(
      "Unrecognized claude CLI version output: not-claude 2.1.232. " +
        "AgentShare requires a recognizable claude CLI and fails closed for unknown executables.",
    );
    expect(
      missingTargetCapabilities(
        "claude",
        "Options:\n  -p, --print  Print mode\n  --tools <tools>  Tools\nA description mentioning --no-chrome",
      ),
    ).toEqual([
      "--no-session-persistence",
      "--strict-mcp-config",
      "--mcp-config",
      "--setting-sources",
      "--disable-slash-commands",
      "--no-chrome",
      "--permission-mode",
    ]);
    expect(
      unsupportedTargetCapabilitiesMessage("claude", "1.0.0", ["--tools"]),
    ).toBe(
      "claude 1.0.0 lacks required isolation controls: --tools. " +
        "Update claude; AgentShare will not weaken its sandbox.",
    );
  });

  it("recovers a pending encrypted upload after transport failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-recovery-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const input = join(directory, "session.md");
    const state = join(directory, "state.json");
    await writeFile(input, "Recover this encrypted handoff.", "utf8");
    const relay = createRelayHandler(new InMemoryRelayStore());
    let failUpload = true;
    const server = startNodeServer(async (request) => {
      if (request.method === "PUT" && failUpload) {
        failUpload = false;
        return Response.json(
          {
            error: { code: "INTERNAL", message: "Synthetic transport failure" },
          },
          { status: 503 },
        );
      }
      return relay(request);
    }, 0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing test address");
    const origin = `http://127.0.0.1:${address.port}`;
    const options = {
      inputPath: input,
      relayOrigin: origin,
      ttlSeconds: 60,
      assumeApproved: true,
      statePath: state,
    } as const;

    await expect(shareCommand(options)).rejects.toMatchObject({ status: 503 });
    const [pending] = (await loadState(state)).shares;
    expect(pending?.pendingUpload).toBeDefined();

    const recovered = await shareCommand(options);
    expect(recovered).toBe(pending?.url);
    expect((await loadState(state)).shares[0]?.pendingUpload).toBeUndefined();
    await expect(openShare(recovered)).resolves.toMatchObject({
      manifest: { title: "session.md" },
    });
  });
});
