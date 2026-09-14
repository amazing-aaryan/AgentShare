import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";
import {
  captureProcess,
  discoverUserSkills,
  resolveAgentExecutable,
  verifyTarget,
} from "../launchers.js";
import { codexEnvironmentArgs } from "./environment-launcher.js";
import { hasRequiredCompletion, readMcpCompletions } from "./completion.js";

// Explicit opt-in: real Codex inference against a synthetic in-memory MCP only.
// This tests approval/transport/receipts, NOT relay publication or owner apply.
it
  .skipIf(process.env.AGENTSHARE_TEST_LOCAL_CODEX !== "1")
  .each(["ask", "propose"] as const)(
  "Codex completes local %s MCP calls with strict isolation",
  async (mode) => {
    await verifyTarget("codex");
    const root = await mkdtemp(join(tmpdir(), "agentshare-local-codex-"));
    try {
      const workspace = join(root, "recipient");
      await mkdir(workspace);
      const fixture = join(root, "fixture.mjs");
      const nonce = randomUUID();
      await build({
        stdin: {
          resolveDir: dirname(fileURLToPath(import.meta.url)),
          sourcefile: "local-fixture.ts",
          contents: `
import { createInterface } from "node:readline";
import { handleMcpRequest } from "./internal-mcp.ts";
import { recordMcpCompletion } from "./completion.ts";
let staged = false;
const runtime = {
  canPropose: process.env.AGENTSHARE_MCP_MODE === "propose",
  environmentInfo: async () => ({ title: "Local fixture" }),
  listFiles: async () => ["fixture.txt"],
  search: async () => [{ source: "fixture.txt", quote: "Read fixture.txt" }],
  readFile: async (path) => { if(path !== "fixture.txt") throw Error("Unknown fixture"); return ${JSON.stringify(nonce)}; },
  readConversation: async () => [],
  stageReplace: async () => { staged = true; return { staged: "replace" }; },
  stageCreate: async () => { throw Error("Not part of this fixture"); },
  stageDelete: async () => { throw Error("Not part of this fixture"); },
  proposalDiff: async () => staged ? [{ type: "replace", path: "fixture.txt" }] : [],
  proposalSubmit: async () => { if (!staged) throw Error("Nothing staged"); return { proposalId: "prop_local_fixture" }; },
};
const channel = { path: process.env.AGENTSHARE_MCP_RECEIPT_PATH, runId: process.env.AGENTSHARE_MCP_RUN_ID, environmentId: "env_local_fixture", mode: process.env.AGENTSHARE_MCP_MODE };
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const response = await handleMcpRequest(JSON.parse(line), runtime, (tool, value) => recordMcpCompletion(channel, tool, value));
  if (response) process.stdout.write(JSON.stringify(response) + "\\n");
}
`,
        },
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
        outfile: fixture,
        logLevel: "silent",
      });
      const channel = {
        path: join(root, "completed.jsonl"),
        runId: randomUUID(),
        environmentId: "env_local_fixture",
        mode,
      };
      const args = codexEnvironmentArgs(
        workspace,
        channel.environmentId,
        process.execPath,
        fixture,
        { mode, receiptChannel: channel },
        await discoverUserSkills(),
      );
      args[args.length - 1] =
        mode === "ask"
          ? "Use the AgentShare read_file tool to read fixture.txt. Return its text exactly. Do not use other tools or external facts."
          : "This is an in-memory local fixture. Use AgentShare read_file on fixture.txt, then proposal_stage_replace with content updated, then proposal_diff, then proposal_submit with summary Local fixture change. No actual owner files or public relay exist. Return the receipt ID.";
      const executable = resolveAgentExecutable("codex");
      const output = await captureProcess(
        executable.command,
        [...executable.prefixArgs, ...args],
        120_000,
      );
      expect(output).not.toContain("user cancelled MCP tool call");
      const receipts = await readMcpCompletions(channel);
      expect(hasRequiredCompletion(receipts, mode, channel.environmentId)).toBe(
        true,
      );
      if (mode === "ask") {
        expect(output).toContain(nonce);
        expect(
          receipts.every((receipt) => !receipt.tool.startsWith("proposal_")),
        ).toBe(true);
      } else {
        expect(receipts.map((receipt) => receipt.tool)).toEqual(
          expect.arrayContaining([
            "read_file",
            "proposal_stage_replace",
            "proposal_diff",
            "proposal_submit",
          ]),
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  150_000,
);
