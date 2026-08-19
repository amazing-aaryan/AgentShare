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
    else {
      for (const [name, item] of Object.entries(key)) this.values.set(name, item);
    }
    return Promise.resolve();
  }

  transaction<T>(callback: (storage: MemoryStorage) => Promise<T>): Promise<T> {
    return callback(this);
  }

  delete(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
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

function auth(capability: string): HeadersInit {
  return { authorization: `Bearer ${capability}` };
}

function id(prefix: string): string {
  return `${prefix}_${randomCapability(18)}`;
}

describe("edge EnvironmentObject", () => {
  it("publishes revisions and isolates read/proposal/inbox capabilities", async () => {
    const object = new EnvironmentObject({
      storage: new MemoryStorage(),
    } as unknown as DurableObjectState);
    const environmentId = id("env");
    const revisionId = id("rev");
    const blobId = id("blob");
    const read = randomCapability();
    const update = randomCapability();
    const propose = randomCapability();
    const inbox = randomCapability();
    const revoke = randomCapability();

    const created = await object.fetch(
      new Request("https://relay.test/v2/environments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          environmentId,
          requestedTtlSeconds: 3600,
          readTokenDigest: capabilityDigest(read),
          updateTokenDigest: capabilityDigest(update),
          proposalTokenDigest: capabilityDigest(propose),
          inboxTokenDigest: capabilityDigest(inbox),
          revokeTokenDigest: capabilityDigest(revoke),
        }),
      }),
    );
    expect(created.status).toBe(201);

    const manifest = Buffer.from("encrypted manifest");
    const blob = Buffer.from("encrypted blob");
    const reserved = await object.fetch(
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
    expect(reserved.status).toBe(201);

    expect(
      (
        await object.fetch(
          new Request(
            `https://relay.test/v2/environments/${environmentId}/revisions/${revisionId}/manifest`,
            { method: "PUT", headers: auth(update), body: manifest },
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await object.fetch(
          new Request(
            `https://relay.test/v2/environments/${environmentId}/blobs/${blobId}`,
            { method: "PUT", headers: auth(update), body: blob },
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await object.fetch(
          new Request(
            `https://relay.test/v2/environments/${environmentId}/revisions/${revisionId}/commit`,
            { method: "POST", headers: auth(update) },
          ),
        )
      ).status,
    ).toBe(200);

    const metadata = await object.fetch(
      new Request(`https://relay.test/v2/environments/${environmentId}/meta`, {
        headers: auth(read),
      }),
    );
    expect(metadata.status).toBe(200);
    expect((await metadata.json()).currentRevisionId).toBe(revisionId);
    expect(
      Buffer.from(
        await (
          await object.fetch(
            new Request(
              `https://relay.test/v2/environments/${environmentId}/blobs/${blobId}`,
              { headers: auth(read) },
            ),
          )
        ).arrayBuffer(),
      ),
    ).toEqual(blob);

    const proposalId = id("proposal");
    const proposal = Buffer.from("encrypted proposal");
    expect(
      (
        await object.fetch(
          new Request(
            `https://relay.test/v2/environments/${environmentId}/proposals`,
            {
              method: "POST",
              headers: {
                ...auth(propose),
                "content-type": "application/json",
              },
              body: JSON.stringify({
                descriptor: {
                  proposalId,
                  baseRevisionId: revisionId,
                  ciphertextSha256: sha256Hex(proposal),
                  ciphertextBytes: proposal.byteLength,
                  ephemeralPublicKey: randomCapability(32),
                },
                ciphertextBase64: proposal.toString("base64"),
              }),
            },
          ),
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await object.fetch(
          new Request(
            `https://relay.test/v2/environments/${environmentId}/proposals`,
            { headers: auth(read) },
          ),
        )
      ).status,
    ).toBe(401);
    const listed = await object.fetch(
      new Request(
        `https://relay.test/v2/environments/${environmentId}/proposals`,
        { headers: auth(inbox) },
      ),
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).proposals).toHaveLength(1);

    expect(
      (
        await object.fetch(
          new Request(`https://relay.test/v2/environments/${environmentId}`, {
            method: "DELETE",
            headers: auth(revoke),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await object.fetch(
          new Request(
            `https://relay.test/v2/environments/${environmentId}/meta`,
            { headers: auth(read) },
          ),
        )
      ).status,
    ).toBe(410);
  });
});
