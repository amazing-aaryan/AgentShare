import { spawnSync } from "node:child_process";

const relay = process.env.AGENTSHARE_E2E_RELAY?.trim();
if (!relay) {
  console.error("AGENTSHARE_E2E_RELAY is required for a live diagnostic.");
  process.exit(1);
}

const targets = (process.env.AGENTSHARE_REAL_AGENT_TARGETS ?? "")
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);
const uniqueTargets = new Set(targets);
if (
  uniqueTargets.size !== 1 ||
  (targets[0] !== "codex" && targets[0] !== "claude")
) {
  console.error(
    "AGENTSHARE_REAL_AGENT_TARGETS must select exactly one diagnostic target: codex or claude.",
  );
  process.exit(1);
}

console.warn(
  `PARTIAL DIAGNOSTIC ONLY: ${targets[0]} does not satisfy the cross-agent release gate.`,
);
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
      AGENTSHARE_REAL_AGENT_TARGETS: targets[0],
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if (result.signal) {
  console.error(`Live diagnostic terminated by ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
