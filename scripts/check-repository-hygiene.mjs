import { execFileSync } from "node:child_process";
import { extname } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const forbiddenDirectories = [
  ".agentshare/",
  ".wrangler/",
  ".codex/",
  "artifacts/",
  "coverage/",
];
const forbiddenExact = new Set(["chat-transcript.md"]);
const privateKeyExtensions = new Set([".key", ".p12", ".pfx"]);

const violations = tracked.filter((path) => {
  const normalized = path.replaceAll("\\", "/");
  const basename = normalized.split("/").at(-1) ?? normalized;
  if (forbiddenExact.has(normalized)) return true;
  if (forbiddenDirectories.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  if (
    basename === ".env" ||
    (basename.startsWith(".env.") && basename !== ".env.example")
  ) {
    return true;
  }
  return privateKeyExtensions.has(extname(basename).toLowerCase());
});

if (violations.length > 0) {
  console.error("Repository hygiene check failed. Forbidden tracked files:");
  for (const path of violations) console.error(`- ${path}`);
  process.exitCode = 1;
} else {
  console.log(
    `Repository hygiene check passed (${tracked.length} tracked files).`,
  );
}
