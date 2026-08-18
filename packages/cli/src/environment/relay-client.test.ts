import { describe, expect, it } from "vitest";
import { EnvironmentRelayClient } from "./relay-client.js";

describe("EnvironmentRelayClient", () => {
  it("rejects non-HTTPS relays outside loopback", () => {
    expect(() => new EnvironmentRelayClient("http://relay.example")).toThrow();
    expect(() => new EnvironmentRelayClient("http://127.0.0.1:8787")).not.toThrow();
  });

  it("sends read capability only to the v2 metadata endpoint", async () => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), authorization: headers.get("authorization") });
      return Response.json({
        protocolVersion: "agentshare-environment-relay-v2",
        environmentId: "env_12345678901234567890",
        createdAt: "2026-08-19T00:00:00.000Z",
        expiresAt: "2026-08-20T00:00:00.000Z",
        status: "active",
        currentRevisionId: null,
        currentRevision: null,
        limits: { maxCiphertextBytes: 50 * 1024 * 1024, maxTtlSeconds: 72 * 60 * 60 },
      });
    };
    const client = new EnvironmentRelayClient("https://relay.example", fetchImpl);
    const metadata = await client.metadata("env_12345678901234567890", "read-secret");
    expect(metadata.environmentId).toBe("env_12345678901234567890");
    expect(seen).toEqual([
      {
        url: "https://relay.example/v2/environments/env_12345678901234567890/meta",
        authorization: "Bearer read-secret",
      },
    ]);
  });
});
