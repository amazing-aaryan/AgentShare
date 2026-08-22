import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeAcb, encodeAcb, logicalFingerprint } from "./canonical.js";

const fixtureRoot = resolve("tests/fixtures/acb-v1");
const EXPECTED_LOGICAL_FINGERPRINT =
  "e593443d314d81fb178d69940eb59409559ba3828d88185a7d771b036194ac31";

describe("ACB v1 conformance fixture", () => {
  it("decodes, verifies resource integrity, and emits the exact canonical bytes", async () => {
    const input = await readFile(resolve(fixtureRoot, "minimal.json"));
    const expectedCanonical = await readFile(
      resolve(fixtureRoot, "minimal.canonical.txt"),
      "utf8",
    );

    const decoded = decodeAcb(input);
    const encoded = encodeAcb(decoded);

    expect(Buffer.from(encoded).toString("utf8")).toBe(expectedCanonical);
    expect(logicalFingerprint(decoded)).toBe(EXPECTED_LOGICAL_FINGERPRINT);
    expect(decodeAcb(encoded)).toEqual(decoded);
  });
});
