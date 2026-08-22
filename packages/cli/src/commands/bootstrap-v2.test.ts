import { describe, expect, it } from "vitest";
import { capabilityLine } from "./bootstrap-v2.js";

describe("recipient bootstrap input", () => {
  it("extracts exactly one capability URL from piped input", () => {
    expect(
      capabilityLine("  https://relay.example/e/env_123#r=x&k=y  \n"),
    ).toBe("https://relay.example/e/env_123#r=x&k=y");
  });

  it("rejects ambiguous multi-line input", () => {
    expect(() => capabilityLine("one\ntwo\n")).toThrow("exactly one");
  });
});
