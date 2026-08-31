/** Real packaged Codex handoff against loopback. Synthetic MCP approvals are NOT native UI evidence. */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import {
  createRelayHandler,
  InMemoryRelayStore,
  startNodeServer,
} from "../apps/relay/src/index.ts";
import { EnvironmentRelayClient } from "../packages/cli/src/environment/relay-client.ts";
import { findOwnedEnvironment } from "../packages/cli/src/environment/state.ts";
import { readOwnedSnapshot } from "../packages/cli/src/environment/owned-snapshot.ts";

const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "agentshare-packaged-handoff-"));
const report = {
  evidenceKind: "local-protocol-diagnostic",
  promotable: false,
  startedAt: new Date().toISOString(),
  cases: [],
  limitations: [
    "Loopback relay, not deployed Workers",
    "Synthetic protocol confirmations, not native human UI",
    "Terminal PTY flow not covered",
  ],
};
const cases = report.cases;
const server = startNodeServer(createRelayHandler(new InMemoryRelayStore()), 0);
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const relay = `http://127.0.0.1:${address.port}`;
let owner;
let environmentId;
const ownerState = join(root, "owner", ".agentshare", "state-v2.json");
let failed;
try {
  const npm = process.env.npm_execpath;
  assert(npm, "Run with npm run test:handoff:local");
  await execute(
    process.execPath,
    [npm, "pack", "./packages/cli", "--pack-destination", root],
    { windowsHide: true },
  );
  const archive = (await readdir(root)).find((name) => name.endsWith(".tgz"));
  assert(archive);
  const archiveBytes = await readFile(join(root, archive));
  const archiveHash = createHash("sha256").update(archiveBytes).digest("hex");
  const retainedPath = resolve(
    "artifacts",
    `agentshare-0.3.0-${archiveHash.slice(0, 12)}.tgz`,
  );
  await mkdir(resolve("artifacts"), { recursive: true });
  await copyFile(join(root, archive), retainedPath);
  report.artifact = {
    name: archive,
    sha256: archiveHash,
    sizeBytes: archiveBytes.length,
    retainedPath,
  };
  const prefix = join(root, "installed");
  await execute(
    process.execPath,
    [
      npm,
      "install",
      "--global",
      "--prefix",
      prefix,
      "--ignore-scripts",
      join(root, archive),
    ],
    { windowsHide: true },
  );
  const npmRoot = (
    await execute(
      process.execPath,
      [npm, "root", "--global", "--prefix", prefix],
      { windowsHide: true },
    )
  ).stdout.trim();
  const cli = join(npmRoot, "agentshare", "dist", "bin.js");
  const workspace = join(root, "workspace");
  const ownerHome = join(root, "owner");
  const recipientHome = join(root, "recipient");
  await mkdir(workspace);
  await mkdir(recipientHome);
  const sessions = join(ownerHome, ".codex", "sessions");
  await mkdir(sessions, { recursive: true });
  const thread = randomUUID();
  const before =
    "Project: LANTERN\nRetry limit: 3\nReason: avoid duplicate deliveries.\n";
  const after = before.replace("limit: 3", "limit: 5");
  await writeFile(join(workspace, "notes.txt"), before);
  await execute("git", ["init", "--quiet", workspace], { windowsHide: true });
  await execute("git", ["-C", workspace, "add", "notes.txt"], {
    windowsHide: true,
  });
  await writeFile(
    join(sessions, `rollout-${thread}.jsonl`),
    [
      { type: "session_meta", payload: { id: thread, cwd: workspace } },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Mira owns the handoff. Keep retry limit 3 until owner approval.",
            },
          ],
        },
      },
    ]
      .map((item) => JSON.stringify(item))
      .join("\n"),
  );
  owner = startMcp(
    cli,
    {
      ...process.env,
      USERPROFILE: ownerHome,
      HOME: ownerHome,
      CODEX_HOME: join(ownerHome, ".codex"),
      AGENTSHARE_NO_UPDATE_CHECK: "1",
      AGENTSHARE_RELAY: relay,
      AGENTSHARE_HANDOFF: relay,
    },
    ownerState,
  );
  await owner.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: { elicitation: { form: {} } },
    clientInfo: { name: "synthetic-diagnostic", version: "1" },
  });
  const session = await owner.call("resolve_creator_session", {
    threadId: thread,
  });
  const draft = await owner.call("prepare_share", {
    sessionRef: session.sessionRef,
    scope: "both",
    access: "read_propose",
    ttlSeconds: 900,
  });
  const reviewed = await owner.call("review_share", {
    draftId: draft.draftId,
    digest: draft.digest,
    section: "files",
  });
  assert.match(reviewed.content, /Retry limit: 3/u);
  const published = await owner.call("commit_share", {
    draftId: draft.draftId,
    digest: draft.digest,
  });
  environmentId = published.environmentId;
  assert(typeof environmentId === "string");
  cases.push({
    name: "packaged creator resolve/prepare/review/commit",
    status: "passed",
  });

  const recipientState = join(recipientHome, ".agentshare", "state-v2.json");
  const storage = [
    "--state-path",
    recipientState,
    "--cache-root",
    join(recipientHome, "cache"),
  ];
  const boot = await runCli(
    cli,
    ["bootstrap", ...storage],
    published.url + "\n",
    {
      ...process.env,
      USERPROFILE: recipientHome,
      HOME: recipientHome,
      CODEX_HOME: join(recipientHome, ".codex"),
      AGENTSHARE_NO_UPDATE_CHECK: "1",
    },
  );
  assert.equal(boot.code, 0, boot.stderr);
  assert.equal(JSON.parse(boot.stdout).files, 1);
  cases.push({
    name: "packaged isolated recipient bootstrap",
    status: "passed",
  });
  const ask = await runCli(cli, [
    "ask",
    "--target",
    "codex",
    "--environment",
    environmentId,
    "--question",
    "Use read_file on notes.txt and read_conversation. What project, retry limit and owner? Cite both sources.",
    ...storage,
  ]);
  assert.equal(ask.code, 0, ask.stderr);
  assert.match(ask.stdout, /LANTERN/u);
  assert.match(ask.stdout, /Mira/u);
  assert.match(ask.stdout, /3/u);
  assert.doesNotMatch(ask.stderr, /user cancelled MCP tool call/iu);
  cases.push({
    name: "real Codex file and conversation MCP read",
    status: "passed",
  });
  const proposed = await runCli(cli, [
    "propose",
    "--target",
    "codex",
    "--environment",
    environmentId,
    "--instruction",
    `Read notes.txt, stage replacement with exactly ${JSON.stringify(after)}, inspect proposal_diff and submit. Change no other file.`,
    ...storage,
  ]);
  assert.equal(proposed.code, 0, proposed.stderr);
  assert.equal(await readFile(join(workspace, "notes.txt"), "utf8"), before);
  const inbox = await owner.call("list_proposals", { environmentId });
  assert.equal(inbox.length, 1);
  cases.push({
    name: "real Codex proposal submission; owner unchanged",
    status: "passed",
  });
  await writeFile(
    join(workspace, "unrelated-private.txt"),
    "Do not publish this unreviewed file",
  );
  const proposalReview = await owner.call("review_proposal", {
    environmentId,
    proposalId: inbox[0].proposalId,
  });
  const approved = await owner.call("commit_proposal", {
    environmentId,
    proposalId: inbox[0].proposalId,
    reviewDigest: proposalReview.reviewDigest,
  });
  assert.notEqual(approved.revisionId, published.revisionId);
  assert.equal(await readFile(join(workspace, "notes.txt"), "utf8"), after);
  const owned = await findOwnedEnvironment(environmentId, ownerState);
  assert(owned);
  const snapshot = await readOwnedSnapshot(
    owned,
    new EnvironmentRelayClient(relay),
  );
  assert.deepEqual(
    snapshot.snapshot.files.map((file) => file.path),
    ["notes.txt"],
  );
  cases.push({
    name: "packaged owner approval; only reviewed proposal published",
    status: "passed",
  });
  const refreshed = await runCli(cli, [
    "ask",
    "--target",
    "codex",
    "--environment",
    environmentId,
    "--question",
    "Read notes.txt. What retry limit is now approved? Cite the file.",
    ...storage,
  ]);
  assert.equal(refreshed.code, 0, refreshed.stderr);
  assert.match(refreshed.stdout, /5/u);
  cases.push({
    name: "original attached link refreshes approved revision",
    status: "passed",
  });
  await owner.call("revoke_share", { environmentId });
  const denied = await runCli(cli, [
    "ask",
    "--target",
    "codex",
    "--environment",
    environmentId,
    "--question",
    "Read notes.txt",
    ...storage,
  ]);
  assert.notEqual(denied.code, 0);
  cases.push({
    name: "packaged owner revoke; recipient denied",
    status: "passed",
  });
} catch (error) {
  failed = error;
  report.error =
    error instanceof Error
      ? error.message.replace(/https?:\/\/\S+#[^\s]+/gu, "[capability omitted]")
      : String(error);
} finally {
  if (environmentId !== undefined) {
    const remaining = await findOwnedEnvironment(environmentId, ownerState);
    if (remaining !== undefined) {
      try {
        await new EnvironmentRelayClient(relay).revoke(
          environmentId,
          remaining.revokeCapability,
        );
      } catch (error) {
        failed ??= error;
        report.cleanupError = "Local fixture revocation failed";
      }
    }
  }
  await owner?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  report.status = failed === undefined ? "passed" : "failed";
  const reportPath = resolve("artifacts", "local-packaged-handoff.json");
  await mkdir(resolve("artifacts"), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `Local packaged handoff ${report.status}; ${cases.length} stages. Non-promotable diagnostic. Report: ${reportPath}`,
  );
}
if (failed !== undefined) process.exitCode = 1;

function startMcp(cli, env, statePath) {
  const child = spawn(
    process.execPath,
    [cli, "creator-mcp", "--state-path", statePath],
    { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let sequence = 0;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    if (value.method === "elicitation/create") {
      // Explicit synthetic fixture consent. Never use this client with real/private content.
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: value.id,
          result: { action: "accept", content: { confirm: true } },
        }) + "\n",
      );
      return;
    }
    const item = pending.get(value.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(value.id);
    if (value.error) item.reject(new Error(value.error.message));
    else item.resolve(value.result);
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {
        resolve,
        reject,
        timer: setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }, 120_000),
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  child.on("close", () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("Creator MCP closed"));
    }
    pending.clear();
  });
  return {
    request,
    async call(name, args) {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError) throw new Error(result.content[0].text);
      return JSON.parse(result.content[0].text);
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) {
        lines.close();
        return;
      }
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      await once(child, "close").catch(() => undefined);
      clearTimeout(timer);
      lines.close();
    },
  };
}

function runCli(cli, args, input = "", env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...env, AGENTSHARE_NO_UPDATE_CHECK: "1" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += String(data);
    });
    child.stderr.on("data", (data) => {
      stderr += String(data);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Packaged CLI timed out"));
    }, 150_000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
