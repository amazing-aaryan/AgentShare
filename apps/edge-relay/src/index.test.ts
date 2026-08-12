import { capabilityDigest, randomCapability, sha256Hex } from "@agentshare/acb";
import { describe, expect, it, vi } from "vitest";
import worker, { RelayControl, ShareObject } from "./index.js";

const MAX_ACTIVE_SHARES = 5_000;
const MAX_ACTIVE_SHARES_PER_ACTOR = 25;
const ACTOR_DIGEST = "a".repeat(64);

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  failNextAlarm = false;
  failNextRecordDelete = false;
  failNextRecordPutAfterWrite = false;

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof key === "string") {
      this.values.set(key, value);
      if (key === "record" && this.failNextRecordPutAfterWrite) {
        this.failNextRecordPutAfterWrite = false;
        return Promise.reject(new Error("synthetic record write failure"));
      }
    } else
      for (const [name, item] of Object.entries(key))
        this.values.set(name, item);
    return Promise.resolve();
  }

  setAlarm(): Promise<void> {
    if (this.failNextAlarm) {
      this.failNextAlarm = false;
      return Promise.reject(new Error("synthetic alarm failure"));
    }
    return Promise.resolve();
  }

  deleteAlarm(): Promise<void> {
    return Promise.resolve();
  }

  transaction<T>(callback: (storage: MemoryStorage) => Promise<T>): Promise<T> {
    return callback(this);
  }

  deleteAll(): Promise<void> {
    this.values.clear();
    return Promise.resolve();
  }

  delete(keys: string | string[]): Promise<void> {
    const selected = typeof keys === "string" ? [keys] : keys;
    if (selected.includes("record") && this.failNextRecordDelete) {
      this.failNextRecordDelete = false;
      return Promise.reject(new Error("synthetic record delete failure"));
    }
    for (const key of selected) this.values.delete(key);
    return Promise.resolve();
  }

  list({ prefix }: { prefix: string }): Promise<Map<string, unknown>> {
    return Promise.resolve(
      new Map([...this.values].filter(([key]) => key.startsWith(prefix))),
    );
  }
}

function createRequest(
  shareId: string,
  read: string,
  upload: string,
  revoke: string,
  requestedTtlSeconds = 60,
) {
  return new Request("https://relay.test/v1/shares", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agentshare-actor-digest": ACTOR_DIGEST,
    },
    body: JSON.stringify({
      shareId,
      requestedTtlSeconds,
      uploadTokenDigest: capabilityDigest(upload),
      readTokenDigest: capabilityDigest(read),
      revokeTokenDigest: capabilityDigest(revoke),
    }),
  });
}

function controlEnv(releaseStatus: () => number) {
  return {
    CONTROL: {
      idFromName: () => ({ name: "global" }),
      get: () => ({
        fetch: (request: Request) =>
          Promise.resolve(
            new Response(null, {
              status: request.method === "DELETE" ? releaseStatus() : 201,
            }),
          ),
      }),
    },
  } as unknown as ConstructorParameters<typeof ShareObject>[1];
}

describe("production edge relay lifecycle", () => {
  it("keeps an expired share ID tombstoned", async () => {
    const storage = new MemoryStorage();
    const object = new ShareObject({
      storage,
    } as unknown as DurableObjectState);
    const shareId = randomCapability(18);
    const read = randomCapability();
    const first = await object.fetch(
      createRequest(shareId, read, randomCapability(), randomCapability()),
    );
    expect(first.status).toBe(201);

    await object.alarm();

    const recreated = await object.fetch(
      createRequest(shareId, read, randomCapability(), randomCapability()),
    );
    expect(recreated.status).toBe(409);
  });

  it("tombstones a logically expired share before its alarm runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
    try {
      const storage = new MemoryStorage();
      const object = new ShareObject({
        storage,
      } as unknown as DurableObjectState);
      const shareId = randomCapability(18);
      const read = randomCapability();
      const upload = randomCapability();
      const revoke = randomCapability();
      expect(
        (await object.fetch(createRequest(shareId, read, upload, revoke)))
          .status,
      ).toBe(201);

      vi.setSystemTime(new Date("2026-08-08T12:01:00.000Z"));
      const retried = await object.fetch(
        createRequest(shareId, read, upload, revoke),
      );

      expect(retried.status).toBe(409);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes authenticated revoke retries idempotent", async () => {
    const storage = new MemoryStorage();
    const object = new ShareObject({
      storage,
    } as unknown as DurableObjectState);
    const shareId = randomCapability(18);
    const revoke = randomCapability();
    await object.fetch(
      createRequest(shareId, randomCapability(), randomCapability(), revoke),
    );
    const request = () =>
      new Request(`https://relay.test/v1/shares/${shareId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${revoke}` },
      });

    expect((await object.fetch(request())).status).toBe(200);
    expect((await object.fetch(request())).status).toBe(200);
  });

  it("retries quota release after a revoked record is persisted", async () => {
    let releases = 0;
    const object = new ShareObject(
      { storage: new MemoryStorage() } as unknown as DurableObjectState,
      controlEnv(() => (++releases === 1 ? 503 : 204)),
    );
    const shareId = randomCapability(18);
    const revoke = randomCapability();
    await object.fetch(
      createRequest(shareId, randomCapability(), randomCapability(), revoke),
    );
    const request = () =>
      new Request(`https://relay.test/v1/shares/${shareId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${revoke}` },
      });

    expect((await object.fetch(request())).status).toBe(503);
    expect((await object.fetch(request())).status).toBe(200);
    expect(releases).toBe(2);
  });

  it("retries quota release when an expiry alarm is retried", async () => {
    let releases = 0;
    const object = new ShareObject(
      { storage: new MemoryStorage() } as unknown as DurableObjectState,
      controlEnv(() => (++releases === 1 ? 503 : 204)),
    );
    await object.fetch(
      createRequest(
        randomCapability(18),
        randomCapability(),
        randomCapability(),
        randomCapability(),
      ),
    );

    await expect(object.alarm()).rejects.toThrow();
    await expect(object.alarm()).resolves.toBeUndefined();
    expect(releases).toBe(2);
  });

  it("serializes concurrent creates for the same share ID", async () => {
    const storage = new MemoryStorage();
    const object = new ShareObject({
      storage,
    } as unknown as DurableObjectState);
    const shareId = randomCapability(18);
    const [first, second] = await Promise.all([
      object.fetch(
        createRequest(
          shareId,
          randomCapability(),
          randomCapability(),
          randomCapability(),
        ),
      ),
      object.fetch(
        createRequest(
          shareId,
          randomCapability(),
          randomCapability(),
          randomCapability(),
        ),
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
  });

  it("rolls back a record when alarm setup fails", async () => {
    const storage = new MemoryStorage();
    storage.failNextAlarm = true;
    const object = new ShareObject({
      storage,
    } as unknown as DurableObjectState);
    const shareId = randomCapability(18);
    const read = randomCapability();
    const upload = randomCapability();
    const revoke = randomCapability();
    const request = () => createRequest(shareId, read, upload, revoke);

    expect((await object.fetch(request())).status).toBe(500);
    expect(storage.values.has("record")).toBe(false);
    expect((await object.fetch(request())).status).toBe(201);
  });

  it("rolls back a partially applied record write", async () => {
    const storage = new MemoryStorage();
    storage.failNextRecordPutAfterWrite = true;
    const object = new ShareObject({
      storage,
    } as unknown as DurableObjectState);
    const shareId = randomCapability(18);
    const read = randomCapability();
    const upload = randomCapability();
    const revoke = randomCapability();
    const request = () => createRequest(shareId, read, upload, revoke);

    expect((await object.fetch(request())).status).toBe(500);
    expect(storage.values.has("record")).toBe(false);
    expect((await object.fetch(request())).status).toBe(201);
  });

  it("recovers when create rollback cannot release capacity", async () => {
    const storage = new MemoryStorage();
    storage.failNextAlarm = true;
    let releases = 0;
    const object = new ShareObject(
      { storage } as unknown as DurableObjectState,
      controlEnv(() => (++releases === 1 ? 503 : 204)),
    );
    const shareId = randomCapability(18);
    const read = randomCapability();
    const upload = randomCapability();
    const revoke = randomCapability();
    const request = () => createRequest(shareId, read, upload, revoke);

    expect((await object.fetch(request())).status).toBe(500);
    expect(storage.values.has("record")).toBe(false);
    expect((await object.fetch(request())).status).toBe(201);
    expect(releases).toBe(1);
  });

  it("preserves alarm and capacity when a partial record cannot be deleted", async () => {
    const storage = new MemoryStorage();
    storage.failNextRecordPutAfterWrite = true;
    storage.failNextRecordDelete = true;
    let releases = 0;
    const object = new ShareObject(
      { storage } as unknown as DurableObjectState,
      controlEnv(() => {
        releases += 1;
        return 204;
      }),
    );
    const shareId = randomCapability(18);
    const read = randomCapability();
    const upload = randomCapability();
    const revoke = randomCapability();
    const request = () => createRequest(shareId, read, upload, revoke);

    expect((await object.fetch(request())).status).toBe(500);
    expect(storage.values.has("record")).toBe(true);
    expect(releases).toBe(0);
    expect((await object.fetch(request())).status).toBe(200);
  });

  it("streams multi-chunk uploads without buffering the request", async () => {
    const storage = new MemoryStorage();
    const object = new ShareObject({
      storage,
    } as unknown as DurableObjectState);
    const shareId = randomCapability(18);
    const upload = randomCapability();
    await object.fetch(
      createRequest(shareId, randomCapability(), upload, randomCapability()),
    );
    const blob = new Uint8Array(3_100_000).fill(7);
    const request = new Request(
      `https://relay.test/v1/shares/${shareId}/blob`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${upload}`,
          "content-length": String(blob.byteLength),
          "x-agentshare-sha256": sha256Hex(blob),
        },
        body: blob,
      },
    );
    Object.defineProperty(request, "arrayBuffer", {
      value: () => Promise.reject(new Error("request buffering is forbidden")),
    });

    expect((await object.fetch(request)).status).toBe(200);
    expect(
      [...storage.values.keys()].filter((key) => key.startsWith("blob:")),
    ).toHaveLength(3);
  });

  it("enforces a global active-share capacity", async () => {
    const storage = new MemoryStorage();
    storage.values.set("quota", {
      entries: Object.fromEntries(
        Array.from({ length: MAX_ACTIVE_SHARES }, (_, index) => [
          `share-${index}`,
          {
            expiresAt: "2099-01-01T00:00:00.000Z",
            bytes: 0,
            actorDigest: String(index).padStart(64, "0"),
          },
        ]),
      ),
      totalBytes: 0,
    });
    const control = new RelayControl({
      storage,
    } as unknown as DurableObjectState);
    const response = await control.fetch(
      new Request(`https://control/v1/reservations/${randomCapability(18)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expiresAt: "2099-01-01T00:00:00.000Z",
          actorDigest: ACTOR_DIGEST,
        }),
      }),
    );
    expect(response.status).toBe(503);
  });

  it("serializes concurrent global reservations", async () => {
    const storage = new MemoryStorage();
    storage.values.set("quota", {
      entries: Object.fromEntries(
        Array.from({ length: MAX_ACTIVE_SHARES - 1 }, (_, index) => [
          `share-${index}`,
          {
            expiresAt: "2099-01-01T00:00:00.000Z",
            bytes: 0,
            actorDigest: String(index).padStart(64, "0"),
          },
        ]),
      ),
      totalBytes: 0,
    });
    const control = new RelayControl({
      storage,
    } as unknown as DurableObjectState);
    const reserve = () =>
      control.fetch(
        new Request(`https://control/v1/reservations/${randomCapability(18)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expiresAt: "2099-01-01T00:00:00.000Z",
            actorDigest: ACTOR_DIGEST,
          }),
        }),
      );
    const responses = await Promise.all([reserve(), reserve()]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 503]);
  });

  it("refreshes expiry when a reservation PUT is retried", async () => {
    const storage = new MemoryStorage();
    const control = new RelayControl({
      storage,
    } as unknown as DurableObjectState);
    const shareId = randomCapability(18);
    const reserve = (expiresAt: string) =>
      control.fetch(
        new Request(`https://control/v1/reservations/${shareId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expiresAt, actorDigest: ACTOR_DIGEST }),
        }),
      );
    const firstExpiry = "2099-01-01T00:01:00.000Z";
    const retriedExpiry = "2099-01-01T00:02:00.000Z";

    expect((await reserve(firstExpiry)).status).toBe(201);
    expect((await reserve(retriedExpiry)).status).toBe(201);
    const quota = storage.values.get("quota") as {
      entries: Record<string, { expiresAt: string }>;
    };
    expect(quota.entries[shareId]?.expiresAt).toBe(retriedExpiry);
  });

  it("limits active shares owned by one actor", async () => {
    const storage = new MemoryStorage();
    const control = new RelayControl({
      storage,
    } as unknown as DurableObjectState);
    const reserve = () =>
      control.fetch(
        new Request(`https://control/v1/reservations/${randomCapability(18)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expiresAt: "2099-01-01T00:00:00.000Z",
            actorDigest: ACTOR_DIGEST,
          }),
        }),
      );

    for (let index = 0; index < MAX_ACTIVE_SHARES_PER_ACTOR; index += 1) {
      expect((await reserve()).status).toBe(201);
    }
    expect((await reserve()).status).toBe(503);
  });

  it("re-admits an expired provisional reservation during upload", async () => {
    const storage = new MemoryStorage();
    const control = new RelayControl({
      storage,
    } as unknown as DurableObjectState);
    const shareId = randomCapability(18);
    const response = await control.fetch(
      new Request(`https://control/v1/reservations/${shareId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bytes: 128,
          expiresAt: "2099-01-01T00:00:00.000Z",
          actorDigest: ACTOR_DIGEST,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(storage.values.get("quota")).toMatchObject({
      entries: {
        [shareId]: {
          bytes: 128,
          expiresAt: "2099-01-01T00:00:00.000Z",
          actorDigest: ACTOR_DIGEST,
        },
      },
      totalBytes: 128,
    });
  });

  it("uses a short provisional reservation then extends it on upload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
    try {
      const storage = new MemoryStorage();
      const requests: Request[] = [];
      const object = new ShareObject(
        { storage } as unknown as DurableObjectState,
        {
          CONTROL: {
            idFromName: () => ({ name: "global" }),
            get: () => ({
              fetch: (request: Request) => {
                requests.push(request.clone());
                return Promise.resolve(new Response(null, { status: 201 }));
              },
            }),
          },
        } as unknown as ConstructorParameters<typeof ShareObject>[1],
      );
      const shareId = randomCapability(18);
      const upload = randomCapability();
      expect(
        (
          await object.fetch(
            createRequest(
              shareId,
              randomCapability(),
              upload,
              randomCapability(),
              72 * 60 * 60,
            ),
          )
        ).status,
      ).toBe(201);
      const provisional = (await requests[0]?.json()) as {
        actorDigest: string;
        expiresAt: string;
      };
      expect(provisional).toEqual({
        actorDigest: ACTOR_DIGEST,
        expiresAt: "2026-08-08T12:10:00.000Z",
      });

      const blob = Buffer.from("encrypted", "utf8");
      expect(
        (
          await object.fetch(
            new Request(`https://relay.test/v1/shares/${shareId}/blob`, {
              method: "PUT",
              headers: {
                authorization: `Bearer ${upload}`,
                "content-length": String(blob.byteLength),
                "x-agentshare-actor-digest": "b".repeat(64),
                "x-agentshare-sha256": sha256Hex(blob),
              },
              body: blob,
            }),
          )
        ).status,
      ).toBe(200);
      expect(await requests[1]?.json()).toEqual({
        actorDigest: ACTOR_DIGEST,
        bytes: blob.byteLength,
        expiresAt: "2026-08-11T12:00:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("overwrites a spoofed internal actor header before Durable Object routing", async () => {
    let forwarded: Request | undefined;
    const request = createRequest(
      randomCapability(18),
      randomCapability(),
      randomCapability(),
      randomCapability(),
    );
    request.headers.set("cf-connecting-ip", "203.0.113.10");
    request.headers.set("x-agentshare-actor-digest", "spoofed");
    const response = await worker.fetch(request, {
      CREATE_RATE_LIMITER: {
        limit: () => Promise.resolve({ success: true }),
      },
      UPLOAD_RATE_LIMITER: {
        limit: () => Promise.resolve({ success: true }),
      },
      SHARES: {
        idFromName: () => ({ name: "share" }),
        get: () => ({
          fetch: (incoming: Request) => {
            forwarded = incoming;
            return Promise.resolve(new Response(null, { status: 201 }));
          },
        }),
      },
    } as unknown as Parameters<typeof worker.fetch>[1]);

    expect(response.status).toBe(201);
    expect(forwarded?.headers.get("x-agentshare-actor-digest")).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(forwarded?.headers.get("x-agentshare-actor-digest")).not.toBe(
      "spoofed",
    );
  });

  it("rejects rate-limited creates before allocating a Durable Object", async () => {
    const response = await worker.fetch(
      createRequest(
        randomCapability(18),
        randomCapability(),
        randomCapability(),
        randomCapability(),
      ),
      {
        CREATE_RATE_LIMITER: {
          limit: () => Promise.resolve({ success: false }),
        },
        UPLOAD_RATE_LIMITER: {
          limit: () => Promise.resolve({ success: true }),
        },
        SHARES: {
          idFromName: () => {
            throw new Error("must not allocate");
          },
        },
      } as unknown as Parameters<typeof worker.fetch>[1],
    );
    expect(response.status).toBe(429);
  });
});
