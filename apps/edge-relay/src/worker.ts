import legacyWorker, { RelayControl, ShareObject } from "./index.js";
import { EnvironmentObject } from "./environment-object.js";

export { EnvironmentObject, RelayControl, ShareObject };

type RateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

type Env = {
  ENVIRONMENTS: DurableObjectNamespace;
  SHARES: DurableObjectNamespace;
  CONTROL: DurableObjectNamespace;
  CREATE_RATE_LIMITER: RateLimiter;
  UPLOAD_RATE_LIMITER: RateLimiter;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith("/v2/environments")) {
      return legacyWorker.fetch(request, env);
    }
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    let environmentId: string | undefined;
    if (request.method === "POST" && url.pathname === "/v2/environments") {
      if (!(await allow(env.CREATE_RATE_LIMITER, request, "environment-create"))) {
        return cors(error("RATE_LIMITED", "Create rate limit exceeded", 429));
      }
      try {
        const body = (await request.clone().json()) as {
          environmentId?: unknown;
        };
        if (typeof body.environmentId === "string") {
          environmentId = body.environmentId;
        }
      } catch {
        return cors(error("BAD_REQUEST", "Invalid request", 400));
      }
    } else {
      const match = /^\/v2\/environments\/([^/]+)/u.exec(url.pathname);
      if (match?.[1] !== undefined) environmentId = decodeURIComponent(match[1]);
    }
    if (environmentId === undefined) {
      return cors(error("NOT_FOUND", "Route not found", 404));
    }

    const isPayloadWrite =
      request.method === "PUT" ||
      (request.method === "POST" && url.pathname.endsWith("/proposals"));
    if (
      isPayloadWrite &&
      !(await allow(env.UPLOAD_RATE_LIMITER, request, "environment-upload"))
    ) {
      return cors(error("RATE_LIMITED", "Upload rate limit exceeded", 429));
    }

    const stub = env.ENVIRONMENTS.get(env.ENVIRONMENTS.idFromName(environmentId));
    return cors(await stub.fetch(request));
  },
};

async function allow(
  limiter: RateLimiter,
  request: Request,
  operation: string,
): Promise<boolean> {
  const actor = request.headers.get("cf-connecting-ip") ?? "unknown";
  return (await limiter.limit({ key: `${operation}:${actor}` })).success;
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

function error(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
