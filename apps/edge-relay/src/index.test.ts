import { capabilityDigest, randomCapability, sha256Hex } from "@agentshare/acb";
import { describe, expect, it, vi } from "vitest";
import worker, { RelayControl, ShareObject } from "./index.js";

const MAX_ACTIVE_SHARES = 5_000;

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  failNextAlarm = false;
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
    for (const key of typeof keys === "string" ? [keys] : keys)
      this.values.delete(key);
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
) {
  return new Request("https://relay.test/v1/shares", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      shareId,
      requestedTtlSeconds: 60,
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
    const request = createRequest(
      randomCapability(18),
      randomCapability(),
      randomCapability(),
      randomCapability(),
    );

    expect((await object.fetch(request.clone())).status).toBe(500);
    expect(storage.values.has("record")).toBe(false);
    expect((await object.fetch(request)).status).toBe(201);
  });

  it("rolls back a partially applied record write", async () => {
    const storage = new MemoryStorage();
    storage.failNextRecordPutAfterWrite = true;
    const object = new ShareObject({
      storage,
    } as unknown as DurableObjectState);
    const request = createRequest(
      randomCapability(18),
      randomCapability(),
      randomCapability(),
      randomCapability(),
    );

    expect((await object.fetch(request.clone())).status).toBe(500);
    expect(storage.values.has("record")).toBe(false);
    expect((await object.fetch(request)).status).toBe(201);
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
          { expiresAt: "2099-01-01T00:00:00.000Z", bytes: 0 },
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
        body: JSON.stringify({ expiresAt: "2099-01-01T00:00:00.000Z" }),
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
          { expiresAt: "2099-01-01T00:00:00.000Z", bytes: 0 },
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
          body: JSON.stringify({ expiresAt: "2099-01-01T00:00:00.000Z" }),
        }),
      );
    const responses = await Promise.all([reserve(), reserve()]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 503]);
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
