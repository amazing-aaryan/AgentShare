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
};

const CHUNK_BYTES = 1_500_000;

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
    const stub = env.SHARES.get(env.SHARES.idFromName(shareId));
    return cors(await stub.fetch(request));
  },
};

export class ShareObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v1/shares") {
        const body: unknown = await request.json();
        return await this.create(createShareRequestSchema.parse(body));
      }

      const match = /^\/v1\/shares\/([^/]+)(?:\/(blob|meta))?$/u.exec(
        url.pathname,
      );
      if (match?.[1] === undefined)
        return error("NOT_FOUND", "Route not found", 404);
      const shareId = decodeURIComponent(match[1]);
      const action = match[2];
      const record = await this.state.storage.get<RelayRecord>("record");
      if (record?.metadata.shareId !== shareId) {
        return error("NOT_FOUND", "Share not found", 404);
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
      if (request.method === "DELETE" && action === undefined) {
        if (!(await authorize(record.revokeTokenDigest, request))) {
          return error("UNAUTHORIZED", "Invalid capability", 401);
        }
        return await this.revoke(record);
      }
      return error("NOT_FOUND", "Route not found", 404);
    } catch (caught) {
      if (isZodError(caught) || caught instanceof SyntaxError) {
        return error("BAD_REQUEST", "Invalid request", 400);
      }
      return error("INTERNAL", "Internal relay error", 500);
    }
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }

  private async create(request: CreateShareRequest): Promise<Response> {
    const existing = await this.state.storage.get<RelayRecord>("record");
    if (existing !== undefined) {
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
    await this.state.storage.put("record", record);
    await this.state.storage.setAlarm(Date.parse(metadata.expiresAt));
    return json(toMetadata(record), 201);
  }

  private async upload(
    record: RelayRecord,
    request: Request,
  ): Promise<Response> {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_CIPHERTEXT_BYTES) {
      return error("PAYLOAD_TOO_LARGE", "Ciphertext exceeds relay limit", 413);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    const descriptor = uploadDescriptorSchema.parse({
      ciphertextSha256: request.headers.get("x-agentshare-sha256"),
      ciphertextBytes: bytes.byteLength,
    });
    if ((await sha256Hex(bytes)) !== descriptor.ciphertextSha256) {
      return error("BAD_REQUEST", "Ciphertext hash mismatch", 400);
    }
    if (record.status === "available") {
      const same =
        record.upload?.ciphertextSha256 === descriptor.ciphertextSha256 &&
        record.upload.ciphertextBytes === descriptor.ciphertextBytes;
      return same
        ? json(toMetadata(record))
        : error("CONFLICT", "Share already contains another blob", 409);
    }

    const chunks: Record<string, Uint8Array> = {};
    for (
      let offset = 0, index = 0;
      offset < bytes.byteLength;
      offset += CHUNK_BYTES, index += 1
    ) {
      chunks[chunkKey(index)] = bytes.slice(offset, offset + CHUNK_BYTES);
    }
    await this.state.storage.put(chunks);
    const available: RelayRecord = {
      ...record,
      status: "available",
      upload: descriptor,
    };
    await this.state.storage.put("record", available);
    return json(toMetadata(available));
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
    if (chunks.size > 0) await this.state.storage.delete([...chunks.keys()]);
    const revoked: RelayRecord = {
      metadata: record.metadata,
      uploadTokenDigest: record.uploadTokenDigest,
      readTokenDigest: record.readTokenDigest,
      revokeTokenDigest: record.revokeTokenDigest,
      status: "revoked",
    };
    await this.state.storage.put("record", revoked);
    return json(toMetadata(revoked));
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
