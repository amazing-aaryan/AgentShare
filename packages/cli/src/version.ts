import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version?: unknown };

if (typeof packageJson.version !== "string") {
  throw new Error("AgentShare package version is unavailable");
}

export const AGENTSHARE_VERSION = packageJson.version;
