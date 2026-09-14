import { describe, expect, it } from "vitest";
import {
  buildEnvironmentUrl,
  parseEnvironmentUrl,
} from "./environment-links.js";

describe("environment URLs", () => {
  it("separates the trusted handoff origin from the ciphertext relay", () => {
    const url = buildEnvironmentUrl({
      handoffOrigin: "https://handoff.example",
      relayOrigin: "https://relay.example",
      environmentId: "env_12345678901234567890",
      readCapability: "r".repeat(43),
      environmentMasterKey: Buffer.alloc(32, 7),
      proposalCapability: "p".repeat(43),
    });
    const parsed = parseEnvironmentUrl(url);

    expect(new URL(url).origin).toBe("https://handoff.example");
    expect(new URL(url).searchParams.get("relay")).toBe(
      "https://relay.example",
    );
    expect(parsed.environmentId).toBe("env_12345678901234567890");
    expect(parsed.readCapability).toBe("r".repeat(43));
    expect(parsed.proposalCapability).toBe("p".repeat(43));
    expect(parsed.environmentMasterKey).toEqual(Buffer.alloc(32, 7));
    expect(parsed.handoffOrigin).toBe("https://handoff.example");
    expect(parsed.relayOrigin).toBe("https://relay.example");
    expect(parsed.safeUrl).toBe(
      "https://handoff.example/e/env_12345678901234567890?relay=https%3A%2F%2Frelay.example",
    );
    expect(parsed.safeUrl).not.toContain(parsed.readCapability);
  });

  it("supports read-only legacy relay-origin links for compatibility", () => {
    const url = buildEnvironmentUrl({
      origin: "https://relay.example",
      environmentId: "env_12345678901234567890",
      readCapability: "r".repeat(43),
      environmentMasterKey: Buffer.alloc(32, 3),
    });
    const parsed = parseEnvironmentUrl(url);
    expect(parsed.proposalCapability).toBeUndefined();
    expect(parsed.handoffOrigin).toBe("https://relay.example");
    expect(parsed.relayOrigin).toBe("https://relay.example");
  });

  it("rejects malformed or incomplete environment links", () => {
    expect(() =>
      parseEnvironmentUrl(
        "https://relay.example/e/env_12345678901234567890#r=short&k=bad",
      ),
    ).toThrow();
    expect(() =>
      parseEnvironmentUrl(
        `https://handoff.example/e/env_12345678901234567890?relay=http%3A%2F%2Fevil.example#r=${"r".repeat(43)}&k=${"A".repeat(43)}`,
      ),
    ).toThrow();
  });
});
