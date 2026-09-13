import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function workflowSource() {
  return readFile(
    new URL("../.github/workflows/deploy-v0.3.2-final.yml", import.meta.url),
    "utf8",
  );
}

test("v0.3.2 production gate keeps immutable candidate bytes separate from reviewed release control", async () => {
  const workflow = await workflowSource();

  assert.match(
    workflow,
    /CANDIDATE_SHA: 4d6957bd2effebf1c1136e1cac60424d88c4eaea/u,
  );
  assert.match(
    workflow,
    /PACKAGE_SHA256: e48f903186f787a6c1865a8d8e25303c3c89e1c8591851aefe81ca0ca9ee5c09/u,
  );
  assert.match(workflow, /PACKAGE_SIZE_BYTES: "156894"/u);
  assert.match(workflow, /ref: \$\{\{ env\.CANDIDATE_SHA \}\}/u);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /path: \.release-control/u);
  assert.match(
    workflow,
    /node \.release-control\/scripts\/check-deployment\.mjs preflight/u,
  );
});

test("v0.3.2 deployment recovery is retry-safe", async () => {
  const workflow = await workflowSource();

  assert.match(
    workflow,
    /RECOVERED_HANDOFF_VERSION_ID: 0c22cb46-524d-4958-9606-d072640db03f/u,
  );
  assert.match(
    workflow,
    /wrangler deployments list --config apps\/edge-relay\/wrangler\.jsonc --json/u,
  );
  assert.match(
    workflow,
    /wrangler deployments list --config apps\/handoff\/wrangler\.jsonc --json/u,
  );
  assert.match(workflow, /current_version.*RECOVERED_HANDOFF_VERSION_ID/su);
  assert.match(workflow, /skipping duplicate upload/u);
  assert.match(
    workflow,
    /npx wrangler deploy --config apps\/handoff\/wrangler\.jsonc/u,
  );
  assert.match(workflow, /for attempt in \$\(seq 1 12\); do/u);
  assert.match(workflow, /node scripts\/check-deployment\.mjs smoke/u);
  assert.match(workflow, /sleep 5/u);
  assert.match(
    workflow,
    /Public smoke did not converge after propagation retries/u,
  );
  assert.match(workflow, /packages\/cli\/src\/public-handoff\.e2e\.test\.ts/u);
  assert.match(
    workflow,
    /packages\/cli\/src\/environment\/public-environment\.e2e\.test\.ts/u,
  );
  assert.match(workflow, /gh release view v0\.3\.2/u);
  assert.match(workflow, /codex-native-windows-v3/u);
});
