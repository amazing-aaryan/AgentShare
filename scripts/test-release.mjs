import { spawnSync } from "node:child_process";

const relay = process.env.AGENTSHARE_E2E_RELAY?.trim();
if (!relay) {
  console.error("AGENTSHARE_E2E_RELAY is required for the release gate.");
  process.exit(1);
}

if (process.env.AGENTSHARE_REAL_AGENT_TARGETS !== undefined) {
  console.error(
    "test:release always runs both agents; use test:live:diagnostic for a partial run.",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "packages/cli/src/public-handoff.e2e.test.ts",
    "packages/cli/src/launcher.security.e2e.test.ts",
    "--reporter=verbose",
  ],
  {
    env: {
      ...process.env,
      AGENTSHARE_REAL_AGENT_E2E: "1",
      AGENTSHARE_REAL_AGENT_TARGETS: "codex,claude",
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if (result.signal) {
  console.error(`Release gate terminated by ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
