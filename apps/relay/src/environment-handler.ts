import {
  createEnvironmentRequestSchema,
  environmentMetadataResponseSchema,
  proposalDescriptorSchema,
  proposalListResponseSchema,
  proposalStatusRequestSchema,
  reserveRevisionRequestSchema,
  type EnvironmentRecord,
} from "@agentshare/contracts";
import {
  InMemoryEnvironmentStore,
  RelayStoreError,
} from "./environment-store.js";

const MAX_JSON_BODY = 70 * 1024 * 1024;

export async function handleEnvironmentRequest(
  store: InMemoryEnvironmentStore,
  request: Request,
  now: Date,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v2/environments")) return undefined;
  try {
    if (request.method === "POST" && url.pathname === "/v2/environments") {
      const body = await readJson(request, 1024 * 1024);
      const record = store.create(
        createEnvironmentRequestSchema.parse(body),
        now,
      );
      return json(toMetadata(record), 201);
    }

    const root = /^\/v2\/environments\/([^/]+)(?:\/(.*))?$/u.exec(url.pathname);
    if (root?.[1] === undefined)
      return error("NOT_FOUND", "Route not found", 404);
    const environmentId = decodeURIComponent(root[1]);
    const rest = root[2] ?? "";
    const capability = bearer(request);

    if (request.method === "GET" && rest === "meta") {
      return json(toMetadata(store.metadata(environmentId, capability, now)));
    }
    if (request.method === "DELETE" && rest === "") {
      return json(toMetadata(store.revoke(environmentId, capability)));
    }

    if (request.method === "POST" && rest === "revisions") {
      const body = await readJson(request, 8 * 1024 * 1024);
      const record = store.reserveRevision(
        environmentId,
        capability,
        reserveRevisionRequestSchema.parse(body),
        now,
      );
      return json(toMetadata(record), 201);
    }

    const manifestMatch = /^revisions\/([^/]+)\/manifest$/u.exec(rest);
    if (manifestMatch?.[1] !== undefined) {
      const revisionId = decodeURIComponent(manifestMatch[1]);
      if (request.method === "PUT") {
        const bytes = await readBoundedBytes(request, 50 * 1024 * 1024);
        return json(
          toMetadata(
            store.uploadManifest(
              environmentId,
              revisionId,
              capability,
              bytes,
              now,
            ),
          ),
        );
      }
      if (request.method === "GET") {
        return binary(
          store.downloadManifest(environmentId, revisionId, capability, now),
        );
      }
    }

    const commitMatch = /^revisions\/([^/]+)\/commit$/u.exec(rest);
    if (request.method === "POST" && commitMatch?.[1] !== undefined) {
      return json(
        toMetadata(
          store.commitRevision(
            environmentId,
            decodeURIComponent(commitMatch[1]),
            capability,
            now,
          ),
        ),
      );
    }

    const blobMatch = /^blobs\/([^/]+)$/u.exec(rest);
    if (blobMatch?.[1] !== undefined) {
      const blobId = decodeURIComponent(blobMatch[1]);
      if (request.method === "PUT") {
        const bytes = await readBoundedBytes(request, 50 * 1024 * 1024);
        return json(
          toMetadata(
            store.uploadBlob(environmentId, blobId, capability, bytes, now),
          ),
        );
      }
      if (request.method === "GET") {
        return binary(
          store.downloadBlob(environmentId, blobId, capability, now),
        );
      }
    }

    if (rest === "proposals") {
      if (request.method === "POST") {
        const body = await readJson(request, MAX_JSON_BODY);
        const object = asObject(body);
        const descriptor = proposalDescriptorSchema.parse(object.descriptor);
        if (typeof object.ciphertextBase64 !== "string") {
          return error("BAD_REQUEST", "Missing proposal ciphertext", 400);
        }
        const ciphertext = Buffer.from(object.ciphertextBase64, "base64");
        return json(
          toMetadata(
            store.submitProposal(
              environmentId,
              capability,
              descriptor,
              ciphertext,
              now,
            ),
          ),
          201,
        );
      }
      if (request.method === "GET") {
        return json(
          proposalListResponseSchema.parse({
            proposals: store.listProposals(environmentId, capability, now),
          }),
        );
      }
    }

    const proposalMatch = /^proposals\/([^/]+)$/u.exec(rest);
    if (request.method === "GET" && proposalMatch?.[1] !== undefined) {
      return binary(
        store.downloadProposal(
          environmentId,
          decodeURIComponent(proposalMatch[1]),
          capability,
          now,
        ),
      );
    }

    const proposalStatusMatch = /^proposals\/([^/]+)\/status$/u.exec(rest);
    if (request.method === "POST" && proposalStatusMatch?.[1] !== undefined) {
      const body = proposalStatusRequestSchema.parse(
        await readJson(request, 64 * 1024),
      );
      return json(
        toMetadata(
          store.setProposalStatus(
            environmentId,
            decodeURIComponent(proposalStatusMatch[1]),
            capability,
            body.status,
            now,
          ),
        ),
      );
    }

    return error("NOT_FOUND", "Route not found", 404);
  } catch (caught) {
    return mapError(caught);
  }
}

function toMetadata(record: EnvironmentRecord): unknown {
  const current =
    record.currentRevisionId === null
      ? null
      : (record.revisions[record.currentRevisionId]?.request ?? null);
  return environmentMetadataResponseSchema.parse({
    protocolVersion: record.protocolVersion,
    environmentId: record.environmentId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    status: record.status,
    currentRevisionId: record.currentRevisionId,
    limits: record.limits,
    currentRevision: current,
  });
}

function bearer(request: Request): string {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(
    request.headers.get("authorization") ?? "",
  );
  if (match?.[1] === undefined)
    throw new RelayStoreError("UNAUTHORIZED", "Missing capability");
  return match[1];
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBoundedBytes(request, maxBytes);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new SyntaxError("Invalid JSON");
  }
}

async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredHeader = request.headers.get("content-length");
  const declared = declaredHeader === null ? undefined : Number(declaredHeader);
  if (declared !== undefined && (!Number.isInteger(declared) || declared < 0)) {
    throw new BadRequestError("Invalid Content-Length");
  }
  if (declared !== undefined && declared > maxBytes) {
    throw new PayloadTooLargeError();
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  if (declared !== undefined && total !== declared) {
    throw new BadRequestError("Content-Length mismatch");
  }
  return Buffer.concat(chunks, total);
}

function binary(value: Uint8Array): Response {
  return new Response(Buffer.from(value), {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
    },
  });
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

function mapError(caught: unknown): Response {
  if (caught instanceof PayloadTooLargeError) {
    return error("PAYLOAD_TOO_LARGE", caught.message, 413);
  }
  if (
    caught instanceof BadRequestError ||
    caught instanceof SyntaxError ||
    isZodError(caught)
  ) {
    return error("BAD_REQUEST", "Invalid request", 400);
  }
  if (caught instanceof RelayStoreError) {
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
  return error("INTERNAL", "Internal relay error", 500);
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestError("Expected object");
  }
  return value as Record<string, unknown>;
}

function isZodError(value: unknown): value is { name: "ZodError" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    value.name === "ZodError"
  );
}

class BadRequestError extends Error {}
class PayloadTooLargeError extends Error {
  constructor() {
    super("Ciphertext exceeds relay limit");
  }
}
