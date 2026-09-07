import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("production preflight binds the named environment without reviewer admin metadata", async () => {
  const source = await readFile(
    new URL("./check-deployment.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /api\("environments\/production"\)/u);
  assert.match(source, /GITHUB_REF !== "refs\/heads\/master"/u);
  assert.match(source, /environment\.name !== "production"/u);
  assert.doesNotMatch(source, /deployment-branch-policies/u);
  assert.doesNotMatch(source, /validateProductionEnvironment/u);
});

test("production workflow keeps candidate bytes separate from reviewed release control", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy-v0.3.1-final.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /ref: \$\{\{ env\.CANDIDATE_SHA \}\}/u);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /path: \.release-control/u);
  assert.match(
    workflow,
    /node \.release-control\/scripts\/check-deployment\.mjs preflight/u,
  );
  assert.match(
    workflow,
    /npx wrangler deploy --config apps\/handoff\/wrangler\.jsonc/u,
  );
});

test("production workflow resumes the proven handoff deployment without relying on a Wrangler output file", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy-v0.3.1-final.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /RECOVERED_HANDOFF_VERSION_ID: fee92509-418f-4ccc-a1a8-a63290b006d2/u,
  );
  assert.match(
    workflow,
    /wrangler deployments list --config apps\/handoff\/wrangler\.jsonc --json/u,
  );
  assert.match(
    workflow,
    /current_version.*RECOVERED_HANDOFF_VERSION_ID/su,
  );
  assert.match(workflow, /skipping duplicate upload/u);
  assert.doesNotMatch(workflow, /WRANGLER_OUTPUT_FILE/u);
});
