import {
  createShareRequestSchema,
  queryCreateRequestSchema,
} from "@agentshare/contracts";
import { renderSharePage } from "@agentshare/web";
export { QueryObject, RelayControl, ShareObject } from "./index.js";

type Env = {
  SHARES: DurableObjectNamespace;
  QUERIES: DurableObjectNamespace;
  CREATE_RATE_LIMITER: RateLimiter;
  UPLOAD_RATE_LIMITER: RateLimiter;
};

type RateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

const ACTOR_HEADER = "x-agentshare-actor-digest";
const MAX_CREATE_BODY_BYTES = 8 * 1024;
const TRUSTED_HANDOFF_ORIGIN =
  "https://agentshare-handoff.carnation-vermicelli.workers.dev";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return metadataPreflight(request, url);
    }
    if (request.method === "GET" && /^\/s\/[^/]+$/u.test(url.pathname)) {
      return sharePage();
    }

    let queryId: string | undefined;
    if (request.method === "POST" && url.pathname === "/v1/queries") {
      try {
        queryId = queryCreateRequestSchema.parse(
          await request.clone().json(),
        ).endpointId;
      } catch {
        return error("BAD_REQUEST", "Invalid request", 400);
      }
    } else {
      const match =
        /^\/v1\/queries\/([^/]+)(?:\/(?:question|answer|meta))?$/u.exec(
          url.pathname,
        );
      if (match?.[1] !== undefined) {
        try {
          queryId = decodeURIComponent(match[1]);
        } catch {
          return error("BAD_REQUEST", "Invalid query ID", 400);
        }
      }
    }
    if (queryId !== undefined) {
      const stub = env.QUERIES.get(env.QUERIES.idFromName(queryId));
      return await stub.fetch(request);
    }

    let shareId: string | undefined;
    let forwarded = request;
    if (request.method === "POST" && url.pathname === "/v1/shares") {
      if (!(await allow(env.CREATE_RATE_LIMITER, request, "create"))) {
        return error("RATE_LIMITED", "Create rate limit exceeded", 429);
      }
      const parsed = await parseBoundedCreate(request);
      if (parsed instanceof Response) return parsed;
      shareId = parsed.shareId;
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      headers.delete("content-length");
      forwarded = new Request(request.url, {
        method: "POST",
        headers,
        body: JSON.stringify(parsed),
      });
    } else {
      const match = /^\/v1\/shares\/([^/]+)(?:\/(?:blob|meta))?$/u.exec(
        url.pathname,
      );
      if (match?.[1] !== undefined) {
        try {
          shareId = decodeURIComponent(match[1]);
        } catch {
          return error("BAD_REQUEST", "Invalid share ID", 400);
        }
      }
    }

    if (shareId === undefined)
      return error("NOT_FOUND", "Route not found", 404);
    if (request.method === "PUT" && url.pathname.endsWith("/blob")) {
      if (!(await allow(env.UPLOAD_RATE_LIMITER, request, "upload"))) {
        return error("RATE_LIMITED", "Upload rate limit exceeded", 429);
      }
    }

    const stub = env.SHARES.get(env.SHARES.idFromName(shareId));
    const headers = new Headers(forwarded.headers);
    headers.set(ACTOR_HEADER, await requestActorDigest(request));
    const response = await stub.fetch(new Request(forwarded, { headers }));
    return isMetadataGet(request, url)
      ? metadataCors(request, response)
      : response;
  },
};

async function parseBoundedCreate(request: Request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      return error("BAD_REQUEST", "Invalid Content-Length", 400);
    }
    if (length > MAX_CREATE_BODY_BYTES) {
      return error(
        "PAYLOAD_TOO_LARGE",
        "Create request exceeds relay limit",
        413,
      );
    }
  }

  const body = await readAtMost(request, MAX_CREATE_BODY_BYTES);
  if (body instanceof Response) return body;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
    const parsed: unknown = JSON.parse(decoded);
    return createShareRequestSchema.parse(parsed);
  } catch {
    return error("BAD_REQUEST", "Invalid request", 400);
  }
}

async function readAtMost(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | Response> {
  if (request.body === null)
    return error("BAD_REQUEST", "Invalid request", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return error(
          "PAYLOAD_TOO_LARGE",
          "Create request exceeds relay limit",
          413,
        );
      }
      chunks.push(value);
    }
  } catch {
    return error("BAD_REQUEST", "Invalid request", 400);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function metadataPreflight(request: Request, url: URL): Response {
  const origin = request.headers.get("origin");
  const requestedMethod = request.headers.get("access-control-request-method");
  const requestedHeaders = (
    request.headers.get("access-control-request-headers") ?? ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeaders = requestedHeaders.every(
    (header) => header === "authorization",
  );

  if (
    origin !== TRUSTED_HANDOFF_ORIGIN ||
    requestedMethod !== "GET" ||
    !allowedHeaders ||
    !/^\/v1\/shares\/[^/]+\/meta$/u.test(url.pathname)
  ) {
    return error("NOT_FOUND", "Route not found", 404);
  }

  const headers = new Headers({
    "access-control-allow-origin": TRUSTED_HANDOFF_ORIGIN,
    "access-control-allow-methods": "GET",
    "access-control-allow-headers": "authorization",
    "access-control-max-age": "600",
    "cache-control": "no-store",
    vary: "Origin",
  });
  return new Response(null, { status: 204, headers });
}

function isMetadataGet(request: Request, url: URL): boolean {
  return (
    request.method === "GET" &&
    /^\/v1\/shares\/[^/]+\/meta$/u.test(url.pathname)
  );
}

function metadataCors(request: Request, response: Response): Response {
  if (request.headers.get("origin") !== TRUSTED_HANDOFF_ORIGIN) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", TRUSTED_HANDOFF_ORIGIN);
  const vary = headers.get("vary");
  headers.set("vary", vary === null ? "Origin" : `${vary}, Origin`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function allow(
  limiter: RateLimiter,
  request: Request,
  operation: string,
): Promise<boolean> {
  const actor = request.headers.get("cf-connecting-ip") ?? "unknown";
  return (await limiter.limit({ key: `${operation}:${actor}` })).success;
}

async function requestActorDigest(request: Request): Promise<string> {
  const actor = request.headers.get("cf-connecting-ip") ?? "unknown";
  const bytes = new TextEncoder().encode(actor);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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
