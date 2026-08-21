import { describe, expect, it } from "vitest";
import worker from "./secure-worker.js";

const HANDOFF_ORIGIN =
  "https://agentshare-handoff.carnation-vermicelli.workers.dev";
const SHARE_ID = "s".repeat(24);

function env(status = 200) {
  let allocations = 0;
  return {
    value: {
      CREATE_RATE_LIMITER: {
        limit: () => Promise.resolve({ success: true }),
      },
      UPLOAD_RATE_LIMITER: {
        limit: () => Promise.resolve({ success: true }),
      },
      SHARES: {
        idFromName: () => {
          allocations += 1;
          return { name: "share" };
        },
        get: () => ({
          fetch: () => Promise.resolve(new Response(null, { status })),
        }),
      },
    } as unknown as Parameters<typeof worker.fetch>[1],
    allocations: () => allocations,
  };
}

function createBody(): string {
  return JSON.stringify({
    shareId: SHARE_ID,
    requestedTtlSeconds: 60,
    uploadTokenDigest: "a".repeat(64),
    readTokenDigest: "b".repeat(64),
    revokeTokenDigest: "c".repeat(64),
  });
}

describe("edge relay browser hardening", () => {
  it("allows the trusted handoff origin to read metadata", async () => {
    const fixture = env();
    const response = await worker.fetch(
      new Request(`https://relay.test/v1/shares/${SHARE_ID}/meta`, {
        headers: {
          authorization: `Bearer ${"r".repeat(43)}`,
          origin: HANDOFF_ORIGIN,
        },
      }),
      fixture.value,
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      HANDOFF_ORIGIN,
    );
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("does not expose create responses through browser CORS", async () => {
    const fixture = env(201);
    const response = await worker.fetch(
      new Request("https://relay.test/v1/shares", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: HANDOFF_ORIGIN,
        },
        body: createBody(),
      }),
      fixture.value,
    );

    expect(response.status).toBe(201);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("only permits metadata GET preflight from the trusted handoff", async () => {
    const fixture = env();
    const allowed = await worker.fetch(
      new Request(`https://relay.test/v1/shares/${SHARE_ID}/meta`, {
        method: "OPTIONS",
        headers: {
          origin: HANDOFF_ORIGIN,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      }),
      fixture.value,
    );
    const denied = await worker.fetch(
      new Request("https://relay.test/v1/shares", {
        method: "OPTIONS",
        headers: {
          origin: HANDOFF_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      }),
      fixture.value,
    );

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      HANDOFF_ORIGIN,
    );
    expect(allowed.headers.get("access-control-allow-methods")).toBe("GET");
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("rejects oversized create JSON before allocating a Durable Object", async () => {
    const fixture = env(201);
    const padded = `${createBody()}${" ".repeat(9_000)}`;
    const response = await worker.fetch(
      new Request("https://relay.test/v1/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: padded,
      }),
      fixture.value,
    );

    expect(response.status).toBe(413);
    expect(fixture.allocations()).toBe(0);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });
});
