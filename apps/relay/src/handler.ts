import { sha256Hex } from "@agentshare/acb";
import { renderSharePage } from "@agentshare/web";
import {
  createShareRequestSchema,
  MAX_CIPHERTEXT_BYTES,
  shareMetadataResponseSchema,
  uploadDescriptorSchema,
  type RelayRecord,
} from "@agentshare/contracts";
import { RelayStateError } from "@agentshare/contracts/relay-machine";
import { handleEnvironmentRequest } from "./environment-handler.js";
import { InMemoryEnvironmentStore } from "./environment-store.js";
import { InMemoryRelayStore, RelayStoreError } from "./store.js";

export type RelayHandlerOptions = {
  now?: () => Date;
  corsOrigin?: string;
};

export function createRelayHandler(
  store: InMemoryRelayStore,
  options: RelayHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const now = options.now ?? (() => new Date());
  const environmentStore = new InMemoryEnvironmentStore();
  return async (request) => {
    if (request.method === "OPTIONS")
      return withCors(new Response(null, { status: 204 }), options);
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && /^\/s\/[^/]+$/u.test(url.pathname)) {
        return sharePage();
      }
      const environmentResponse = await handleEnvironmentRequest(
        environmentStore,
        request,
        now(),
      );
      if (environmentResponse !== undefined) {
        return withCors(environmentResponse, options);
      }
      if (request.method === "POST" && url.pathname === "/v1/shares") {
        const body: unknown = await request.json();
        const record = store.create(
          createShareRequestSchema.parse(body),
          now(),
        );
        return withCors(json(toMetadata(record), 201), options);
      }

      const match = /^\/v1\/shares\/([^/]+)(?:\/(blob|meta))?$/u.exec(
        url.pathname,
      );
      if (match?.[1] === undefined)
        return withCors(error("NOT_FOUND", "Route not found", 404), options);
      const shareId = decodeURIComponent(match[1]);
      const action = match[2];
      const capability = bearer(request);

      if (request.method === "GET" && action === "meta") {
        return withCors(
          json(toMetadata(store.metadata(shareId, capability, now()))),
          options,
        );
      }
      if (request.method === "GET" && action === "blob") {
        return withCors(
          new Response(
            Buffer.from(store.download(shareId, capability, now())),
            {
              headers: {
                "content-type": "application/octet-stream",
                "cache-control": "no-store",
              },
            },
          ),
          options,
        );
      }
      if (request.method === "PUT" && action === "blob") {
        const received = await readBoundedBody(request);
        if (received instanceof Response) return withCors(received, options);
        const blob = received;
        const descriptor = uploadDescriptorSchema.parse({
          ciphertextSha256: request.headers.get("x-agentshare-sha256"),
          ciphertextBytes: blob.byteLength,
        });
        if (sha256Hex(blob) !== descriptor.ciphertextSha256) {
          return withCors(
            error("BAD_REQUEST", "Ciphertext hash mismatch", 400),
            options,
          );
        }
        const record = store.upload(
          shareId,
          capability,
          descriptor,
          blob,
          now(),
        );
        return withCors(json(toMetadata(record)), options);
      }
      if (request.method === "DELETE" && action === undefined) {
        return withCors(
          json(toMetadata(store.revoke(shareId, capability))),
          options,
        );
      }
      return withCors(error("NOT_FOUND", "Route not found", 404), options);
    } catch (caught) {
      return withCors(mapError(caught), options);
    }
  };
}

async function readBoundedBody(
  request: Request,
): Promise<Uint8Array | Response> {
  const declaredHeader = request.headers.get("content-length");
  const declared = declaredHeader === null ? undefined : Number(declaredHeader);
  if (
    declared !== undefined &&
    (!Number.isInteger(declared) || declared <= 0)
  ) {
    return error("BAD_REQUEST", "Invalid Content-Length", 400);
  }
  if (declared !== undefined && declared > MAX_CIPHERTEXT_BYTES) {
    return error("PAYLOAD_TOO_LARGE", "Ciphertext exceeds relay limit", 413);
  }
  if (request.body === null)
    return error("BAD_REQUEST", "Missing ciphertext", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CIPHERTEXT_BYTES) {
      await reader.cancel();
      return error("PAYLOAD_TOO_LARGE", "Ciphertext exceeds relay limit", 413);
    }
    chunks.push(value);
  }
  if (declared !== undefined && total !== declared) {
    return error("BAD_REQUEST", "Content-Length mismatch", 400);
  }
  return Buffer.concat(chunks, total);
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

function toMetadata(record: RelayRecord): unknown {
  return shareMetadataResponseSchema.parse({
    metadata: record.metadata,
    status: record.status,
    ...(record.upload === undefined ? {} : { upload: record.upload }),
  });
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization");
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(header ?? "");
  if (match?.[1] === undefined)
    throw new RelayStoreError("UNAUTHORIZED", "Missing capability");
  return match[1];
}

function mapError(caught: unknown): Response {
  if (caught instanceof RelayStoreError || caught instanceof RelayStateError) {
    const statuses = {
      UNAUTHORIZED: 401,
      NOT_FOUND: 404,
      CONFLICT: 409,
      EXPIRED: 410,
      REVOKED: 410,
      PAYLOAD_TOO_LARGE: 413,
    } as const;
    return error(caught.code, caught.message, statuses[caught.code]);
  }
  if (caught instanceof SyntaxError || isZodError(caught)) {
    return error("BAD_REQUEST", "Invalid request", 400);
  }
  return error("INTERNAL", "Internal relay error", 500);
}

function isZodError(value: unknown): value is { name: "ZodError" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    value.name === "ZodError"
  );
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

function withCors(response: Response, options: RelayHandlerOptions): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", options.corsOrigin ?? "*");
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
