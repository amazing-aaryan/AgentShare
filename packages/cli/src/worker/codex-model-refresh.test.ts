import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { refreshCodexModelCache } from "./codex-model-refresh.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function home() {
  const path = await mkdtemp(join(tmpdir(), "agentshare-refresh-test-"));
  directories.push(path);
  return path;
}
function executable(source: string) {
  return { command: process.execPath, prefixArgs: ["-e", source, "--"] };
}
const protocol = `
const lines = require('node:readline').createInterface({input: process.stdin});
const canonical = path => require('node:fs').realpathSync(path).toLowerCase();
lines.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    if (!process.env.CODEX_HOME || canonical(process.cwd()) !== canonical(process.env.CODEX_HOME)) process.exit(3);
    process.stdout.write('null\\n');
    process.stdout.write(JSON.stringify({id: 1, result: {}}) + '\\n');
  } else if (request.method === 'model/list') {
    RESPONSE
  } else if (request.method !== 'initialized') process.exit(4);
});`;

describe("Codex model metadata refresh transport", () => {
  it("negotiates initialize/model-list in the private home and closes without a model turn", async () => {
    await expect(
      refreshCodexModelCache(
        executable(
          protocol.replace(
            "RESPONSE",
            "process.stdout.write(JSON.stringify({id:2,result:{data:[{id:'test-model'}]}}) + '\\n');",
          ),
        ),
        await home(),
      ),
    ).resolves.toBeUndefined();
  });
  it("reports protocol errors without leaking provider error bodies", async () => {
    await expect(
      refreshCodexModelCache(
        executable(
          protocol.replace(
            "RESPONSE",
            "process.stdout.write(JSON.stringify({id:2,error:{message:'private-provider-body'}}) + '\\n');",
          ),
        ),
        await home(),
      ),
    ).rejects.toThrow(/^Codex could not refresh model metadata;/);
  });
  it("fails closed on a missing model-list result", async () => {
    await expect(
      refreshCodexModelCache(
        executable(
          protocol.replace(
            "RESPONSE",
            "process.stdout.write(JSON.stringify({id:2,result:{}}) + '\\n');",
          ),
        ),
        await home(),
      ),
    ).rejects.toThrow("invalid model metadata");
  });
  it("bounds a stalled app-server", async () => {
    await expect(
      refreshCodexModelCache(
        executable("setInterval(() => {}, 1000)"),
        await home(),
        200,
      ),
    ).rejects.toThrow("timed out");
  });
  it("bounds an oversized app-server response", async () => {
    await expect(
      refreshCodexModelCache(
        executable(
          "process.stdout.write('x'.repeat(5 * 1024 * 1024)); setInterval(() => {}, 1000)",
        ),
        await home(),
      ),
    ).rejects.toThrow("exceeded its limit");
  });
  it("reports an absent executable without hanging", async () => {
    await expect(
      refreshCodexModelCache(
        { command: join(await home(), "missing-codex"), prefixArgs: [] },
        await home(),
      ),
    ).rejects.toThrow("could not start");
  });
});
