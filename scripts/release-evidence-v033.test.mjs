import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOLLOW_UP_NATIVE_WINDOWS_OBSERVATIONS,
  FOLLOW_UP_NATIVE_WINDOWS_PROFILE,
  FOLLOW_UP_NATIVE_WINDOWS_RUNTIME,
  runEvidenceCli,
} from "./release-evidence.mjs";

test("v0.3.3 follow-up Windows profile is distinct from immutable v0.3.2", () => {
  assert.equal(FOLLOW_UP_NATIVE_WINDOWS_PROFILE, "codex-native-windows-v4");
  assert.deepEqual(FOLLOW_UP_NATIVE_WINDOWS_RUNTIME, {
    platform: "win32",
    osRelease: "10.0.26200",
    nodeVersion: "24.14.0",
    agent: "codex",
    agentVersion: "0.153.4",
  });
  assert.equal(
    FOLLOW_UP_NATIVE_WINDOWS_OBSERVATIONS.bootstrap.installedVersion,
    "0.3.3",
  );
  assert.equal(
    FOLLOW_UP_NATIVE_WINDOWS_OBSERVATIONS.read.mcpReceiptVerified,
    true,
  );
  assert.equal(
    FOLLOW_UP_NATIVE_WINDOWS_OBSERVATIONS.isolation
      .canonicalModelMetadataUnmodified,
    true,
  );
  assert.equal(
    FOLLOW_UP_NATIVE_WINDOWS_OBSERVATIONS.isolation
      .modelMetadataCompatibilityVerified,
    true,
  );
  assert.equal(Object.isFrozen(FOLLOW_UP_NATIVE_WINDOWS_RUNTIME), true);
  assert.equal(Object.isFrozen(FOLLOW_UP_NATIVE_WINDOWS_OBSERVATIONS), true);
});

test("v0.3.3 profile is explicitly registered and still needs evidence", () => {
  assert.throws(
    () => runEvidenceCli(["--profile", FOLLOW_UP_NATIVE_WINDOWS_PROFILE]),
    /--evidence required/,
  );
});
