import { Buffer } from "node:buffer";
import { capabilityDigest, randomCapability, sha256Hex } from "@agentshare/acb";
import { describe, expect, it } from "vitest";
import { EnvironmentObject } from "./environment-object.js";

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }
  put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof key === "string") this.values.set(key, value);
    else
      for (const [name, item] of Object.entries(key))
        this.values.set(name, item);
    return Promise.resolve();
  }
  transaction<T>(callback: (storage: MemoryStorage) => Promise<T>): Promise<T> {
    return callback(this);
  }
  delete(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys)
      this.values.delete(key);
    return Promise.resolve();
  }
  list({ prefix }: { prefix: string }): Promise<Map<string, unknown>> {
    return Promise.resolve(
      new Map([...this.values].filter(([key]) => key.startsWith(prefix))),
    );
  }
  setAlarm(): Promise<void> {
    return Promise.resolve();
  }
  deleteAlarm(): Promise<void> {
    return Promise.resolve();
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomCapability(18)}`;
}

function auth(capability: string): Record<string, string> {
  return { authorization: `Bearer ${capability}` };
}

describe("edge environment quota accounting", () => {
  it("reserves creator capacity, updates ciphertext bytes, and releases on revoke", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const control = {
      fetch: async (request: Request) => {
        calls.push({
          method: request.method,
          url: new URL(request.url).pathname,
          ...(request.method === "PUT" || request.method === "PATCH"
            ? { body: await request.json() }
            : {}),
        });
        return Response.json(
          { reserved: true },
          { status: request.method === "PUT" ? 201 : 200 },
        );
      },
    };
    const env = {
      CONTROL: {
        get: () => control,
        idFromName: () => ({}) as DurableObjectId,
      },
    } as unknown as { CONTROL: DurableObjectNamespace };
    const object = new EnvironmentObject(
      { storage: new MemoryStorage() } as unknown as DurableObjectState,
      env,
    );
    const environmentId = id("env");
    const revisionId = id("rev");
    const blobId = id("blob");
    const read = randomCapability();
    const update = randomCapability();
    const inbox = randomCapability();
    const revoke = randomCapability();
    const actorDigest = "a".repeat(64);

    expect(
      (
        await object.fetch(
          new Request("https://relay.test/v2/environments", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-agentshare-actor-digest": actorDigest,
            },
            body: JSON.stringify({
              environmentId,
              requestedTtlSeconds: 3600,
              readTokenDigest: capabilityDigest(read),
              updateTokenDigest: capabilityDigest(update),
              inboxTokenDigest: capabilityDigest(inbox),
              revokeTokenDigest: capabilityDigest(revoke),
            }),
          }),
        )
      ).status,
    ).toBe(201);
    expect(calls[0]).toMatchObject({
      method: "PUT",
      url: `/v1/reservations/${environmentId}`,
      body: { actorDigest },
    });

    const manifest = Buffer.from("encrypted manifest");
    const blob = Buffer.from("encrypted blob");
    await object.fetch(
      new Request(
        `https://relay.test/v2/environments/${environmentId}/revisions`,
        {
          method: "POST",
          headers: { ...auth(update), "content-type": "application/json" },
          body: JSON.stringify({
            revisionId,
            manifest: {
              ciphertextSha256: sha256Hex(manifest),
              ciphertextBytes: manifest.byteLength,
            },
            blobs: [
              {
                blobId,
                ciphertextSha256: sha256Hex(blob),
                ciphertextBytes: blob.byteLength,
              },
            ],
          }),
        },
      ),
    );
    await object.fetch(
      new Request(
        `https://relay.test/v2/environments/${environmentId}/revisions/${revisionId}/manifest`,
        { method: "PUT", headers: auth(update), body: manifest },
      ),
    );
    expect(calls.at(-1)).toMatchObject({
      method: "PATCH",
      body: { actorDigest, bytes: manifest.byteLength },
    });
    await object.fetch(
      new Request(
        `https://relay.test/v2/environments/${environmentId}/blobs/${blobId}`,
        {
          method: "PUT",
          headers: auth(update),
          body: blob,
        },
      ),
    );
    expect(calls.at(-1)).toMatchObject({
      method: "PATCH",
      body: { actorDigest, bytes: manifest.byteLength + blob.byteLength },
    });

    await object.fetch(
      new Request(`https://relay.test/v2/environments/${environmentId}`, {
        method: "DELETE",
        headers: auth(revoke),
      }),
    );
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: `/v1/reservations/${environmentId}`,
    });
  });
});
