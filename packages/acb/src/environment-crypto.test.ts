import { describe, expect, it } from "vitest";
import {
  decryptEnvironmentObject,
  encryptEnvironmentObject,
  randomEnvironmentMasterKey,
} from "./environment-crypto.js";

const context = {
  environmentId: "env_12345678901234567890",
  revisionId: "rev_12345678901234567890",
  kind: "manifest" as const,
  objectId: "manifest_1234567890123456",
};

describe("environment object crypto", () => {
  it("roundtrips plaintext under a derived object key", () => {
    const key = randomEnvironmentMasterKey();
    const encrypted = encryptEnvironmentObject(Buffer.from("hello"), key, context);
    expect(Buffer.from(decryptEnvironmentObject(encrypted.envelope, key, context)).toString()).toBe("hello");
  });

  it("fails when authenticated context changes", () => {
    const key = randomEnvironmentMasterKey();
    const encrypted = encryptEnvironmentObject(Buffer.from("hello"), key, context);
    expect(() =>
      decryptEnvironmentObject(encrypted.envelope, key, { ...context, revisionId: "rev_other_123456789012345" }),
    ).toThrow();
  });

  it("fails with a different master key", () => {
    const encrypted = encryptEnvironmentObject(Buffer.from("hello"), randomEnvironmentMasterKey(), context);
    expect(() => decryptEnvironmentObject(encrypted.envelope, randomEnvironmentMasterKey(), context)).toThrow();
  });
});
