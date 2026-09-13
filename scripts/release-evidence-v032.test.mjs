import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FORWARD_NATIVE_WINDOWS_OBSERVATIONS,
  FORWARD_NATIVE_WINDOWS_PROFILE,
  FORWARD_NATIVE_WINDOWS_RUNTIME,
  runEvidenceCli,
} from "./release-evidence.mjs";

test("v0.3.2 forward-compatible Windows profile is a new frozen contract", () => {
  assert.equal(FORWARD_NATIVE_WINDOWS_PROFILE, "codex-native-windows-v3");
  assert.deepEqual(FORWARD_NATIVE_WINDOWS_RUNTIME, {
    platform: "win32",
    osRelease: "10.0.26200",
    nodeVersion: "24.14.0",
    agent: "codex",
    agentVersion: "0.153.4",
  });
  assert.equal(
    FORWARD_NATIVE_WINDOWS_OBSERVATIONS.bootstrap.installedVersion,
    "0.3.2",
  );
  assert.equal(
    FORWARD_NATIVE_WINDOWS_OBSERVATIONS.read.mcpReceiptVerified,
    true,
  );
  assert.equal(
    FORWARD_NATIVE_WINDOWS_OBSERVATIONS.isolation
      .canonicalModelMetadataUnmodified,
    true,
  );
  assert.equal(
    FORWARD_NATIVE_WINDOWS_OBSERVATIONS.isolation
      .modelMetadataCompatibilityVerified,
    true,
  );
  assert.equal(Object.isFrozen(FORWARD_NATIVE_WINDOWS_RUNTIME), true);
  assert.equal(Object.isFrozen(FORWARD_NATIVE_WINDOWS_OBSERVATIONS), true);
});

test("v0.3.2 profile is explicitly registered rather than falling back to an older profile", () => {
  assert.throws(
    () => runEvidenceCli(["--profile", FORWARD_NATIVE_WINDOWS_PROFILE]),
    /--evidence required/,
  );
});
