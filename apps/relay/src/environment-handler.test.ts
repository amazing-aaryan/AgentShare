import { describe, expect, it } from "vitest";
import { capabilityDigest, sha256Hex } from "@agentshare/acb";
import { createRelayHandler } from "./handler.js";
import { InMemoryRelayStore } from "./store.js";

const environmentId = "env_12345678901234567890";
const revisionId = "rev_12345678901234567890";
const blobId = "blob_12345678901234567890";
const proposalId = "prop_12345678901234567890";
const read = "read_" + "r".repeat(40);
const update = "update_" + "u".repeat(38);
const propose = "propose_" + "p".repeat(37);
const inbox = "inbox_" + "i".repeat(39);
const revoke = "revoke_" + "v".repeat(38);

async function createEnvironment(handler: (request: Request) => Promise<Response>) {
  return handler(
    new Request("http://relay.test/v2/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        environmentId,
        requestedTtlSeconds: 86400,
        readTokenDigest: capabilityDigest(read),
        updateTokenDigest: capabilityDigest(update),
        proposalTokenDigest: capabilityDigest(propose),
        inboxTokenDigest: capabilityDigest(inbox),
        revokeTokenDigest: capabilityDigest(revoke),
      }),
    }),
  );
}

describe("v2 environment HTTP routes", () => {
  it("publishes and reads an immutable environment revision", async () => {
    const handler = createRelayHandler(new InMemoryRelayStore(), {
      now: () => new Date("2026-08-19T00:00:00.000Z"),
    });
    expect((await createEnvironment(handler)).status).toBe(201);
    const manifest = Buffer.from("encrypted-manifest");
    const blob = Buffer.from("encrypted-blob");
    const reserved = await handler(
      new Request(`http://relay.test/v2/environments/${environmentId}/revisions`, {
        method: "POST",
        headers: { authorization: `Bearer ${update}`, "content-type": "application/json" },
        body: JSON.stringify({
          revisionId,
          manifest: { ciphertextSha256: sha256Hex(manifest), ciphertextBytes: manifest.byteLength },
          blobs: [{ blobId, ciphertextSha256: sha256Hex(blob), ciphertextBytes: blob.byteLength }],
        }),
      }),
    );
    expect(reserved.status).toBe(201);
    expect(
      (
        await handler(
          new Request(`http://relay.test/v2/environments/${environmentId}/revisions/${revisionId}/manifest`, {
            method: "PUT",
            headers: { authorization: `Bearer ${update}` },
            body: manifest,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handler(
          new Request(`http://relay.test/v2/environments/${environmentId}/blobs/${blobId}`, {
            method: "PUT",
            headers: { authorization: `Bearer ${update}` },
            body: blob,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handler(
          new Request(`http://relay.test/v2/environments/${environmentId}/revisions/${revisionId}/commit`, {
            method: "POST",
            headers: { authorization: `Bearer ${update}` },
          }),
        )
      ).status,
    ).toBe(200);

    const meta = await handler(
      new Request(`http://relay.test/v2/environments/${environmentId}/meta`, {
        headers: { authorization: `Bearer ${read}` },
      }),
    );
    expect((await meta.json() as { currentRevisionId: string }).currentRevisionId).toBe(revisionId);
    const downloadedManifest = await handler(
      new Request(`http://relay.test/v2/environments/${environmentId}/revisions/${revisionId}/manifest`, {
        headers: { authorization: `Bearer ${read}` },
      }),
    );
    expect(Buffer.from(await downloadedManifest.arrayBuffer())).toEqual(manifest);
    const downloadedBlob = await handler(
      new Request(`http://relay.test/v2/environments/${environmentId}/blobs/${blobId}`, {
        headers: { authorization: `Bearer ${read}` },
      }),
    );
    expect(Buffer.from(await downloadedBlob.arrayBuffer())).toEqual(blob);
  });

  it("accepts opaque encrypted proposals and exposes them only to the owner inbox", async () => {
    const handler = createRelayHandler(new InMemoryRelayStore(), {
      now: () => new Date("2026-08-19T00:00:00.000Z"),
    });
    await createEnvironment(handler);
    const manifest = Buffer.from("m");
    await handler(new Request(`http://relay.test/v2/environments/${environmentId}/revisions`, {
      method: "POST",
      headers: { authorization: `Bearer ${update}`, "content-type": "application/json" },
      body: JSON.stringify({ revisionId, manifest: { ciphertextSha256: sha256Hex(manifest), ciphertextBytes: 1 }, blobs: [] }),
    }));
    await handler(new Request(`http://relay.test/v2/environments/${environmentId}/revisions/${revisionId}/manifest`, {
      method: "PUT", headers: { authorization: `Bearer ${update}` }, body: manifest,
    }));
    await handler(new Request(`http://relay.test/v2/environments/${environmentId}/revisions/${revisionId}/commit`, {
      method: "POST", headers: { authorization: `Bearer ${update}` },
    }));

    const ciphertext = Buffer.from("proposal-ciphertext");
    const submitted = await handler(new Request(`http://relay.test/v2/environments/${environmentId}/proposals`, {
      method: "POST",
      headers: { authorization: `Bearer ${propose}`, "content-type": "application/json" },
      body: JSON.stringify({
        descriptor: {
          proposalId,
          baseRevisionId: revisionId,
          ciphertextSha256: sha256Hex(ciphertext),
          ciphertextBytes: ciphertext.byteLength,
          ephemeralPublicKey: "k".repeat(43),
        },
        ciphertextBase64: ciphertext.toString("base64"),
      }),
    }));
    expect(submitted.status).toBe(201);
    expect((await handler(new Request(`http://relay.test/v2/environments/${environmentId}/proposals`, {
      headers: { authorization: `Bearer ${propose}` },
    }))).status).toBe(401);
    const listed = await handler(new Request(`http://relay.test/v2/environments/${environmentId}/proposals`, {
      headers: { authorization: `Bearer ${inbox}` },
    }));
    expect((await listed.json() as { proposals: unknown[] }).proposals).toHaveLength(1);
    const downloaded = await handler(new Request(`http://relay.test/v2/environments/${environmentId}/proposals/${proposalId}`, {
      headers: { authorization: `Bearer ${inbox}` },
    }));
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(ciphertext);
  });
});
