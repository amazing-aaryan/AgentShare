import { spawnSync } from "node:child_process";

const relay = process.env.AGENTSHARE_E2E_RELAY?.trim();
if (!relay) {
  console.error("AGENTSHARE_E2E_RELAY is required for the release gate.");
  process.exit(1);
}

const targets = (process.env.AGENTSHARE_REAL_AGENT_TARGETS ?? "codex,claude")
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);
const invalidTargets = targets.filter(
  (target) => target !== "codex" && target !== "claude",
);
if (targets.length === 0 || invalidTargets.length > 0) {
  console.error(
    "AGENTSHARE_REAL_AGENT_TARGETS must contain codex, claude, or both.",
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
      AGENTSHARE_REAL_AGENT_TARGETS: targets.join(","),
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
