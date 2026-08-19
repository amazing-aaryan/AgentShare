import { spawnSync } from "node:child_process";

const relay = requireHttpsOrigin(
  "AGENTSHARE_E2E_RELAY",
  process.env.AGENTSHARE_E2E_RELAY,
);
const handoff = requireHttpsOrigin(
  "AGENTSHARE_E2E_HANDOFF",
  process.env.AGENTSHARE_E2E_HANDOFF,
);
if (relay === handoff) {
  console.error(
    "AGENTSHARE_E2E_RELAY and AGENTSHARE_E2E_HANDOFF must be distinct origins for the release gate.",
  );
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
      AGENTSHARE_E2E_RELAY: relay,
      AGENTSHARE_E2E_HANDOFF: handoff,
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

function requireHttpsOrigin(name, value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    console.error(`${name} is required for the release gate.`);
    process.exit(1);
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    console.error(`${name} must be a valid HTTPS origin.`);
    process.exit(1);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    console.error(`${name} must be a bare HTTPS origin.`);
    process.exit(1);
  }
  return url.origin;
}
