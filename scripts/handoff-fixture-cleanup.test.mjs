import assert from "node:assert/strict";
import { test } from "node:test";
import { revokeHandoffFixtures } from "./handoff-fixture-cleanup.mjs";

test("cleanup closes the owner and revokes persisted commits without RPC result IDs", async () => {
  const events = [];
  const environment = { environmentId: "persisted-before-lost-response" };
  const failures = await revokeHandoffFixtures({
    closeOwner: async () => events.push("closed"),
    loadOwned: async () => {
      events.push("loaded");
      return [environment];
    },
    revoke: async (value) => events.push(value.environmentId),
  });
  assert.deepEqual(events, ["closed", "loaded", environment.environmentId]);
  assert.deepEqual(failures, []);
});

test("cleanup reports uncertain revocation but still attempts remaining shares", async () => {
  const attempted = [];
  const failures = await revokeHandoffFixtures({
    closeOwner: async () => {},
    loadOwned: async () => [
      { environmentId: "failed" },
      { environmentId: "recovered" },
    ],
    revoke: async ({ environmentId }) => {
      attempted.push(environmentId);
      if (environmentId === "failed") throw new Error("network unavailable");
    },
  });
  assert.deepEqual(attempted, ["failed", "recovered"]);
  assert.deepEqual(failures, ["failed"]);
});

test("cleanup does not read state while the owner could still mutate it", async () => {
  await assert.rejects(
    revokeHandoffFixtures({
      closeOwner: async () => {
        throw new Error("owner still running");
      },
      loadOwned: async () => assert.fail("must not read live state"),
      revoke: async () => assert.fail("must not revoke live state"),
    }),
    /owner still running/u,
  );
});
