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
