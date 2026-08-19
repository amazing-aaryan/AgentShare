import { describe, expect, it } from "vitest";
import {
  buildEnvironmentUrl,
  parseEnvironmentUrl,
} from "./environment-links.js";

describe("environment URLs", () => {
  it("roundtrips read, key, and proposal capabilities", () => {
    const url = buildEnvironmentUrl({
      origin: "https://relay.example",
      environmentId: "env_12345678901234567890",
      readCapability: "r".repeat(43),
      environmentMasterKey: Buffer.alloc(32, 7),
      proposalCapability: "p".repeat(43),
    });
    const parsed = parseEnvironmentUrl(url);
    expect(parsed.environmentId).toBe("env_12345678901234567890");
    expect(parsed.readCapability).toBe("r".repeat(43));
    expect(parsed.proposalCapability).toBe("p".repeat(43));
    expect(parsed.environmentMasterKey).toEqual(Buffer.alloc(32, 7));
    expect(parsed.safeUrl).toBe(
      "https://relay.example/e/env_12345678901234567890",
    );
  });

  it("supports read-only links without a proposal capability", () => {
    const url = buildEnvironmentUrl({
      origin: "https://relay.example",
      environmentId: "env_12345678901234567890",
      readCapability: "r".repeat(43),
      environmentMasterKey: Buffer.alloc(32, 3),
    });
    expect(parseEnvironmentUrl(url).proposalCapability).toBeUndefined();
  });

  it("rejects malformed or incomplete environment links", () => {
    expect(() =>
      parseEnvironmentUrl(
        "https://relay.example/e/env_12345678901234567890#r=short&k=bad",
      ),
    ).toThrow();
  });
});
