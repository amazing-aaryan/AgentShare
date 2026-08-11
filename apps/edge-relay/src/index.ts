import { createHash } from "node:crypto";
import {
  createShareRequestSchema,
  MAX_CIPHERTEXT_BYTES,
  MAX_TTL_SECONDS,
  PROTOCOL_VERSION,
  shareMetadataResponseSchema,
  uploadDescriptorSchema,
  type AuthoritativeMetadata,
  type CreateShareRequest,
  type RelayRecord,
} from "@agentshare/contracts";
import { renderSharePage } from "@agentshare/web";

type Env = {
  SHARES: DurableObjectNamespace;
  CONTROL: DurableObjectNamespace;
  CREATE_RATE_LIMITER: RateLimiter;
  UPLOAD_RATE_LIMITER: RateLimiter;
};

const CHUNK_BYTES = 1_500_000;
const MAX_ACTIVE_SHARES = 5_000;
const MAX_ACTIVE_CIPHERTEXT_BYTES = 4_000_000_000;

type RateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

type QuotaState = {
  entries: Record<string, { expiresAt: string; bytes: number }>;
  totalBytes: number;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS")
      return cors(new Response(null, { status: 204 }));
    const url = new URL(request.url);
    if (request.method === "GET" && /^\/s\/[^/]+$/u.test(url.pathname)) {
      return sharePage();
    }

    let shareId: string | undefined;
    if (request.method === "POST" && url.pathname === "/v1/shares") {
      if (!(await allow(env.CREATE_RATE_LIMITER, request, "create"))) {
        return cors(error("RATE_LIMITED", "Create rate limit exceeded", 429));
      }
      const clone = request.clone();
      try {
        const body: unknown = await clone.json();
        shareId = createShareRequestSchema.parse(body).shareId;
      } catch {
        return cors(error("BAD_REQUEST", "Invalid request", 400));
      }
    } else {
      const match = /^\/v1\/shares\/([^/]+)(?:\/(?:blob|meta))?$/u.exec(
        url.pathname,
      );
      if (match?.[1] !== undefined) shareId = decodeURIComponent(match[1]);
    }

    if (shareId === undefined)
      return cors(error("NOT_FOUND", "Route not found", 404));
    if (request.method === "PUT" && url.pathname.endsWith("/blob")) {
      if (!(await allow(env.UPLOAD_RATE_LIMITER, request, "upload"))) {
        return cors(error("RATE_LIMITED", "Upload rate limit exceeded", 429));
      }
    }
    const stub = env.SHARES.get(env.SHARES.idFromName(shareId));
    return cors(await stub.fetch(request));
  },
};

export class ShareObject {
  private lifecycleTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env?: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v1/shares") {
        const body: unknown = await request.json();
        const parsed = createShareRequestSchema.parse(body);
        return await this.serialize(() => this.create(parsed));
      }

      const match = /^\/v1\/shares\/([^/]+)(?:\/(blob|meta))?$/u.exec(
        url.pathname,
      );
      if (match?.[1] === undefined)
        return error("NOT_FOUND", "Route not found", 404);
      const shareId = decodeURIComponent(match[1]);
      const action = match[2];
      const handle = () => this.handleExisting(request, shareId, action);
      return request.method === "PUT" || request.method === "DELETE"
        ? await this.serialize(handle)
        : await handle();
    } catch (caught) {
      if (isZodError(caught) || caught instanceof SyntaxError) {
        return error("BAD_REQUEST", "Invalid request", 400);
      }
      return error("INTERNAL", "Internal relay error", 500);
    }
  }

  private async handleExisting(
    request: Request,
    shareId: string,
    action: string | undefined,
  ): Promise<Response> {
    const record = await this.state.storage.get<RelayRecord>("record");
    if (record?.metadata.shareId !== shareId) {
      return error("NOT_FOUND", "Share not found", 404);
    }

    if (request.method === "DELETE" && action === undefined) {
      if (!(await authorize(record.revokeTokenDigest, request))) {
        return error("UNAUTHORIZED", "Invalid capability", 401);
      }
      if (record.status === "revoked") return json(toMetadata(record));
      if (effectiveStatus(record) === "expired") {
        return error("EXPIRED", "Share expired", 410);
      }
      return await this.revoke(record);
    }

    const status = effectiveStatus(record);
    if (status === "expired") return error("EXPIRED", "Share expired", 410);
    if (status === "revoked") return error("REVOKED", "Share revoked", 410);

    if (request.method === "GET" && action === "meta") {
      if (!(await authorize(record.readTokenDigest, request))) {
        return error("UNAUTHORIZED", "Invalid capability", 401);
      }
      return json(toMetadata(record));
    }
    if (request.method === "GET" && action === "blob") {
      if (!(await authorize(record.readTokenDigest, request))) {
        return error("UNAUTHORIZED", "Invalid capability", 401);
      }
      if (record.status !== "available" || record.upload === undefined) {
        return error("NOT_FOUND", "Ciphertext is not available", 404);
      }
      return this.download(record.upload.ciphertextBytes);
    }
    if (request.method === "PUT" && action === "blob") {
      if (!(await authorize(record.uploadTokenDigest, request))) {
        return error("UNAUTHORIZED", "Invalid capability", 401);
      }
      return await this.upload(record, request);
    }
    return error("NOT_FOUND", "Route not found", 404);
  }

  async alarm(): Promise<void> {
    await this.serialize(() => this.expire());
  }

  private async expire(): Promise<void> {
    const record = await this.state.storage.get<RelayRecord>("record");
    if (record === undefined) return;
    const chunks = await this.state.storage.list({ prefix: "blob:" });
    const withoutUpload: RelayRecord = {
      metadata: record.metadata,
      uploadTokenDigest: record.uploadTokenDigest,
      readTokenDigest: record.readTokenDigest,
      revokeTokenDigest: record.revokeTokenDigest,
      status: record.status,
    };
    await this.state.storage.transaction(async (transaction) => {
      if (chunks.size > 0) await transaction.delete([...chunks.keys()]);
      await transaction.put("record", {
        ...withoutUpload,
        status: record.status === "revoked" ? "revoked" : "expired",
      });
    });
    await this.releaseCapacity(record.metadata.shareId);
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleTail;
    let release!: () => void;
    this.lifecycleTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async create(request: CreateShareRequest): Promise<Response> {
    const existing = await this.state.storage.get<RelayRecord>("record");
    if (existing !== undefined) {
      if (existing.status === "expired" || existing.status === "revoked") {
        return error("CONFLICT", "Share ID has already been consumed", 409);
      }
      const same =
        existing.uploadTokenDigest === request.uploadTokenDigest &&
        existing.readTokenDigest === request.readTokenDigest &&
        existing.revokeTokenDigest === request.revokeTokenDigest;
      return same
        ? json(toMetadata(existing))
        : error("CONFLICT", "Share ID already exists", 409);
    }

    const createdAt = new Date();
    const ttl = Math.min(request.requestedTtlSeconds, MAX_TTL_SECONDS);
    const metadata: AuthoritativeMetadata = {
      protocolVersion: PROTOCOL_VERSION,
      shareId: request.shareId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttl * 1000).toISOString(),
      limits: {
        maxCiphertextBytes: MAX_CIPHERTEXT_BYTES,
        maxTtlSeconds: MAX_TTL_SECONDS,
      },
    };
    const record: RelayRecord = {
      metadata,
      uploadTokenDigest: request.uploadTokenDigest,
      readTokenDigest: request.readTokenDigest,
      revokeTokenDigest: request.revokeTokenDigest,
      status: "awaiting-upload",
    };
    const reservation = await this.reserveCapacity(metadata);
    if (reservation !== undefined) return reservation;
    try {
      await this.state.storage.put("record", record);
      await this.state.storage.setAlarm(Date.parse(metadata.expiresAt));
    } catch (error) {
      await this.releaseCapacity(metadata.shareId);
      throw error;
    }
    return json(toMetadata(record), 201);
  }

  private async upload(
    record: RelayRecord,
    request: Request,
  ): Promise<Response> {
    const declaredLength = Number(request.headers.get("content-length"));
    if (!Number.isInteger(declaredLength) || declaredLength <= 0) {
      return error("BAD_REQUEST", "Content-Length is required", 400);
    }
    if (declaredLength > MAX_CIPHERTEXT_BYTES) {
      return error("PAYLOAD_TOO_LARGE", "Ciphertext exceeds relay limit", 413);
    }
    const descriptor = uploadDescriptorSchema.parse({
      ciphertextSha256: request.headers.get("x-agentshare-sha256"),
      ciphertextBytes: declaredLength,
    });
    if (record.status === "available") {
      const same =
        record.upload?.ciphertextSha256 === descriptor.ciphertextSha256 &&
        record.upload.ciphertextBytes === descriptor.ciphertextBytes;
      return same
        ? json(toMetadata(record))
        : error("CONFLICT", "Share already contains another blob", 409);
    }

    const streamed = await this.storeUpload(
      request,
      descriptor.ciphertextSha256,
    );
    if (streamed instanceof Response) return streamed;
    if (streamed.bytes !== descriptor.ciphertextBytes) {
      await this.deleteChunks(streamed.keys);
      return error("BAD_REQUEST", "Content-Length mismatch", 400);
    }
    if (streamed.digest !== descriptor.ciphertextSha256) {
      await this.deleteChunks(streamed.keys);
      return error("BAD_REQUEST", "Ciphertext hash mismatch", 400);
    }
    const capacity = await this.reserveBytes(
      record,
      descriptor.ciphertextBytes,
    );
    if (capacity !== undefined) {
      await this.deleteChunks(streamed.keys);
      return capacity;
    }
    const available: RelayRecord = {
      ...record,
      status: "available",
      upload: descriptor,
    };
    await this.state.storage.transaction(async (transaction) => {
      await transaction.put("record", available);
    });
    return json(toMetadata(available));
  }

  private async storeUpload(
    request: Request,
    expectedDigest: string,
  ): Promise<{ bytes: number; digest: string; keys: string[] } | Response> {
    if (!/^[a-f0-9]{64}$/u.test(expectedDigest) || request.body === null) {
      return error("BAD_REQUEST", "Invalid upload", 400);
    }
    const reader = request.body.getReader();
    const hash = createHash("sha256");
    const keys: string[] = [];
    let total = 0;
    let index = 0;
    let pending = new Uint8Array(CHUNK_BYTES);
    let pendingBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_CIPHERTEXT_BYTES) {
          await reader.cancel();
          await this.deleteChunks(keys);
          return error(
            "PAYLOAD_TOO_LARGE",
            "Ciphertext exceeds relay limit",
            413,
          );
        }
        hash.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const copied = Math.min(
            CHUNK_BYTES - pendingBytes,
            value.byteLength - offset,
          );
          pending.set(value.subarray(offset, offset + copied), pendingBytes);
          pendingBytes += copied;
          offset += copied;
          if (pendingBytes === CHUNK_BYTES) {
            const key = chunkKey(index);
            await this.state.storage.put(key, pending);
            keys.push(key);
            index += 1;
            pending = new Uint8Array(CHUNK_BYTES);
            pendingBytes = 0;
          }
        }
      }
      if (pendingBytes > 0) {
        const key = chunkKey(index);
        await this.state.storage.put(key, pending.slice(0, pendingBytes));
        keys.push(key);
      }
      return { bytes: total, digest: hash.digest("hex"), keys };
    } catch (caught) {
      await this.deleteChunks(keys);
      throw caught;
    }
  }

  private async deleteChunks(keys: string[]): Promise<void> {
    if (keys.length > 0) await this.state.storage.delete(keys);
  }

  private download(ciphertextBytes: number): Response {
    const chunkCount = Math.ceil(ciphertextBytes / CHUNK_BYTES);
    let index = 0;
    const storage = this.state.storage;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (index >= chunkCount) {
          controller.close();
          return;
        }
        const chunk = await storage.get<Uint8Array>(chunkKey(index));
        if (chunk === undefined) {
          controller.error(new Error("Missing ciphertext chunk"));
          return;
        }
        index += 1;
        controller.enqueue(chunk);
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(ciphertextBytes),
        "cache-control": "no-store",
      },
    });
  }

  private async revoke(record: RelayRecord): Promise<Response> {
    const chunks = await this.state.storage.list({ prefix: "blob:" });
    const revoked: RelayRecord = {
      metadata: record.metadata,
      uploadTokenDigest: record.uploadTokenDigest,
      readTokenDigest: record.readTokenDigest,
      revokeTokenDigest: record.revokeTokenDigest,
      status: "revoked",
    };
    await this.state.storage.transaction(async (transaction) => {
      if (chunks.size > 0) await transaction.delete([...chunks.keys()]);
      await transaction.put("record", revoked);
    });
    await this.releaseCapacity(record.metadata.shareId);
    return json(toMetadata(revoked));
  }

  private async reserveCapacity(
    metadata: AuthoritativeMetadata,
  ): Promise<Response | undefined> {
    const control = this.control();
    if (control === undefined) return undefined;
    const response = await control.fetch(
      new Request(`https://control/v1/reservations/${metadata.shareId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresAt: metadata.expiresAt }),
      }),
    );
    return response.ok
      ? undefined
      : error("CAPACITY", "Public relay is at active-share capacity", 503);
  }

  private async reserveBytes(
    record: RelayRecord,
    bytes: number,
  ): Promise<Response | undefined> {
    const control = this.control();
    if (control === undefined) return undefined;
    const response = await control.fetch(
      new Request(
        `https://control/v1/reservations/${record.metadata.shareId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bytes }),
        },
      ),
    );
    return response.ok
      ? undefined
      : error("CAPACITY", "Public relay is at ciphertext capacity", 503);
  }

  private async releaseCapacity(shareId: string): Promise<void> {
    const control = this.control();
    if (control === undefined) return;
    await control.fetch(
      new Request(`https://control/v1/reservations/${shareId}`, {
        method: "DELETE",
      }),
    );
  }

  private control(): DurableObjectStub | undefined {
    return this.env?.CONTROL.get(this.env.CONTROL.idFromName("global"));
  }
}

export class RelayControl {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    return this.serialize(() => this.handleFetch(request));
  }

  private async handleFetch(request: Request): Promise<Response> {
    const match = /^\/v1\/reservations\/([A-Za-z0-9_-]{20,100})$/u.exec(
      new URL(request.url).pathname,
    );
    if (match?.[1] === undefined)
      return error("NOT_FOUND", "Route not found", 404);
    const shareId = match[1];
    const quota = await this.loadPruned();
    if (request.method === "PUT") {
      const body: unknown = await request.json();
      const expiresAt = field(body, "expiresAt");
      if (
        typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt))
      ) {
        return error("BAD_REQUEST", "Invalid reservation expiry", 400);
      }
      if (quota.entries[shareId] === undefined) {
        if (Object.keys(quota.entries).length >= MAX_ACTIVE_SHARES) {
          return error("CAPACITY", "Active share capacity reached", 503);
        }
        quota.entries[shareId] = { expiresAt, bytes: 0 };
      }
      await this.save(quota);
      return json({ reserved: true }, 201);
    }
    if (request.method === "PATCH") {
      const body: unknown = await request.json();
      const bytes = field(body, "bytes");
      const entry = quota.entries[shareId];
      if (entry === undefined)
        return error("NOT_FOUND", "Reservation not found", 404);
      if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
        return error("BAD_REQUEST", "Invalid reservation size", 400);
      }
      const nextTotal = quota.totalBytes - entry.bytes + bytes;
      if (nextTotal > MAX_ACTIVE_CIPHERTEXT_BYTES) {
        return error("CAPACITY", "Ciphertext capacity reached", 503);
      }
      entry.bytes = bytes;
      quota.totalBytes = nextTotal;
      await this.save(quota);
      return json({ reserved: true });
    }
    if (request.method === "DELETE") {
      const entry = quota.entries[shareId];
      if (entry !== undefined) {
        quota.totalBytes -= entry.bytes;
        quota.entries = Object.fromEntries(
          Object.entries(quota.entries).filter(([id]) => id !== shareId),
        );
        await this.save(quota);
      }
      return json({ released: true });
    }
    return error("NOT_FOUND", "Route not found", 404);
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => this.save(await this.loadPruned()));
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async loadPruned(): Promise<QuotaState> {
    const stored = (await this.state.storage.get<QuotaState>("quota")) ?? {
      entries: {},
      totalBytes: 0,
    };
    const now = Date.now();
    const entries = Object.fromEntries(
      Object.entries(stored.entries).filter(
        ([, entry]) => Date.parse(entry.expiresAt) > now,
      ),
    );
    return {
      entries,
      totalBytes: Object.values(entries).reduce(
        (total, entry) => total + entry.bytes,
        0,
      ),
    };
  }

  private async save(quota: QuotaState): Promise<void> {
    quota.totalBytes = Math.max(0, quota.totalBytes);
    await this.state.storage.put("quota", quota);
    const expiries = Object.values(quota.entries).map((entry) =>
      Date.parse(entry.expiresAt),
    );
    if (expiries.length === 0) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(Math.min(...expiries));
  }
}

function effectiveStatus(record: RelayRecord): RelayRecord["status"] {
  if (record.status === "revoked") return "revoked";
  return Date.now() >= Date.parse(record.metadata.expiresAt)
    ? "expired"
    : record.status;
}

function toMetadata(record: RelayRecord): unknown {
  return shareMetadataResponseSchema.parse({
    metadata: record.metadata,
    status: record.status,
    ...(record.upload === undefined ? {} : { upload: record.upload }),
  });
}

async function authorize(
  expectedDigest: string,
  request: Request,
): Promise<boolean> {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(
    request.headers.get("authorization") ?? "",
  );
  if (match?.[1] === undefined) return false;
  return constantTimeEqual(
    expectedDigest,
    await sha256Hex(new TextEncoder().encode(match[1])),
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function allow(
  limiter: RateLimiter,
  request: Request,
  operation: string,
): Promise<boolean> {
  const actor = request.headers.get("cf-connecting-ip") ?? "unknown";
  return (await limiter.limit({ key: `${operation}:${actor}` })).success;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function chunkKey(index: number): string {
  return `blob:${String(index).padStart(5, "0")}`;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set(
    "access-control-allow-headers",
    "authorization, content-type, x-agentshare-sha256",
  );
  headers.set(
    "access-control-allow-methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  return new Response(response.body, { status: response.status, headers });
}

function sharePage(): Response {
  return new Response(renderSharePage(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function isZodError(value: unknown): value is { name: "ZodError" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    value.name === "ZodError"
  );
}
