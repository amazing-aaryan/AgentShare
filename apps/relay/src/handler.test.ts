import { describe, expect, it } from "vitest";
import { capabilityDigest, randomCapability, sha256Hex } from "@agentshare/acb";
import { createRelayHandler } from "./handler.js";
import { InMemoryRelayStore } from "./store.js";

describe("relay handler", () => {
  it("serves a no-store share page without reflecting capabilities", async () => {
    const handler = createRelayHandler(new InMemoryRelayStore());
    const response = await handler(
      new Request(
        "http://relay.test/s/share-id?r=reader-secret#k=fragment-secret",
      ),
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(html).not.toContain("reader-secret");
    expect(html).not.toContain("fragment-secret");
  });

  it("creates, uploads, retries, downloads, and revokes blindly", async () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    const handler = createRelayHandler(new InMemoryRelayStore(), {
      now: () => now,
    });
    const shareId = randomCapability(18);
    const upload = randomCapability();
    const read = randomCapability();
    const revoke = randomCapability();
    const created = await handler(
      new Request("http://relay.test/v1/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shareId,
          requestedTtlSeconds: 60,
          uploadTokenDigest: capabilityDigest(upload),
          readTokenDigest: capabilityDigest(read),
          revokeTokenDigest: capabilityDigest(revoke),
        }),
      }),
    );
    expect(created.status).toBe(201);

    const blob = Buffer.from("ciphertext");
    const uploadRequest = () =>
      new Request(`http://relay.test/v1/shares/${shareId}/blob`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${upload}`,
          "x-agentshare-sha256": sha256Hex(blob),
        },
        body: blob,
      });
    expect((await handler(uploadRequest())).status).toBe(200);
    expect((await handler(uploadRequest())).status).toBe(200);

    const downloaded = await handler(
      new Request(`http://relay.test/v1/shares/${shareId}/blob`, {
        headers: { authorization: `Bearer ${read}` },
      }),
    );
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(blob);

    const revoked = await handler(
      new Request(`http://relay.test/v1/shares/${shareId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${revoke}` },
      }),
    );
    expect(revoked.status).toBe(200);
    expect(
      (
        await handler(
          new Request(`http://relay.test/v1/shares/${shareId}/blob`, {
            headers: { authorization: `Bearer ${read}` },
          }),
        )
      ).status,
    ).toBe(410);
  });

  it("rejects invalid read capabilities", async () => {
    const handler = createRelayHandler(new InMemoryRelayStore());
    const response = await handler(
      new Request("http://relay.test/v1/shares/missing/meta", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(response.status).toBe(404);
  });
});
