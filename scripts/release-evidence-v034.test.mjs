import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOLLOW_UP_NATIVE_WINDOWS_PROFILE,
  REPAIRED_NATIVE_WINDOWS_OBSERVATIONS,
  REPAIRED_NATIVE_WINDOWS_PROFILE,
  REPAIRED_NATIVE_WINDOWS_RUNTIME,
  runEvidenceCli,
} from "./release-evidence.mjs";

test("v0.3.4 repair has a new frozen Windows evidence profile", () => {
  assert.equal(FOLLOW_UP_NATIVE_WINDOWS_PROFILE, "codex-native-windows-v4");
  assert.equal(REPAIRED_NATIVE_WINDOWS_PROFILE, "codex-native-windows-v5");
  assert.deepEqual(REPAIRED_NATIVE_WINDOWS_RUNTIME, {
    platform: "win32",
    osRelease: "10.0.26200",
    nodeVersion: "24.14.0",
    agent: "codex",
    agentVersion: "0.153.4",
  });
  assert.equal(
    REPAIRED_NATIVE_WINDOWS_OBSERVATIONS.bootstrap.installedVersion,
    "0.3.4",
  );
  assert.equal(
    REPAIRED_NATIVE_WINDOWS_OBSERVATIONS.read.mcpReceiptVerified,
    true,
  );
  assert.equal(
    REPAIRED_NATIVE_WINDOWS_OBSERVATIONS.isolation
      .canonicalModelMetadataUnmodified,
    true,
  );
  assert.equal(
    REPAIRED_NATIVE_WINDOWS_OBSERVATIONS.isolation
      .modelMetadataCompatibilityVerified,
    true,
  );
  assert.equal(Object.isFrozen(REPAIRED_NATIVE_WINDOWS_RUNTIME), true);
  assert.equal(Object.isFrozen(REPAIRED_NATIVE_WINDOWS_OBSERVATIONS), true);
});

test("v0.3.4 profile is registered and still requires real evidence", () => {
  assert.throws(
    () => runEvidenceCli(["--profile", REPAIRED_NATIVE_WINDOWS_PROFILE]),
    /--evidence required/,
  );
});
