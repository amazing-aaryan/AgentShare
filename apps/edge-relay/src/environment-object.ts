import { Buffer } from "node:buffer";
import {
  addEnvironmentProposal,
  commitEnvironmentRevision,
  createEnvironmentRecord,
  createEnvironmentRequestSchema,
  effectiveEnvironmentStatus,
  environmentMetadataResponseSchema,
  EnvironmentStateError,
  MAX_CIPHERTEXT_BYTES,
  proposalDescriptorSchema,
  proposalListResponseSchema,
  proposalStatusRequestSchema,
  recordEnvironmentBlob,
  recordEnvironmentManifest,
  reserveEnvironmentRevision,
  reserveRevisionRequestSchema,
  revokeEnvironment,
  setEnvironmentProposalStatus,
  type CiphertextDescriptor,
  type CreateEnvironmentRequest,
  type EnvironmentRecord,
} from "@agentshare/contracts";

const CHUNK_BYTES = 1_500_000;
const MAX_JSON_BODY = 70 * 1024 * 1024;
const ACTOR_HEADER = "x-agentshare-actor-digest";

type EnvironmentObjectEnv = {
  CONTROL: DurableObjectNamespace;
};

export class EnvironmentObject {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env?: EnvironmentObjectEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const write = request.method !== "GET";
    const operation = () => this.handle(request);
    return write ? this.serialize(operation) : operation();
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => {
      const record = await this.state.storage.get<EnvironmentRecord>("record");
      if (record === undefined) return;
      await this.deletePayloads();
      await this.state.storage.put("record", {
        ...record,
        status: record.status === "revoked" ? "revoked" : "expired",
      } satisfies EnvironmentRecord);
      if (!(await this.releaseCapacity(record.environmentId))) {
        throw new Error("Environment capacity release unavailable");
      }
    });
  }

  private async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v2/environments") {
        return await this.create(
          createEnvironmentRequestSchema.parse(
            await readJson(request, 1024 * 1024),
          ),
          request,
        );
      }

      const root = /^\/v2\/environments\/([^/]+)(?:\/(.*))?$/u.exec(
        url.pathname,
      );
      if (root?.[1] === undefined) return notFound();
      const environmentId = decodeURIComponent(root[1]);
      const rest = root[2] ?? "";
      const record = await this.requiredRecord(environmentId);

      if (request.method === "DELETE" && rest === "") {
        if (!(await authorize(record.revokeTokenDigest, request))) {
          return unauthorized();
        }
        if (record.status !== "revoked") await this.deletePayloads();
        const revoked = revokeEnvironment(record);
        await this.state.storage.put("record", revoked);
        if (!(await this.releaseCapacity(environmentId))) {
          return error("INTERNAL", "Capacity release unavailable", 503);
        }
        return json(toMetadata(revoked));
      }

      const status = effectiveEnvironmentStatus(record, new Date());
      if (status === "expired")
        return error("EXPIRED", "Environment expired", 410);
      if (status === "revoked")
        return error("REVOKED", "Environment revoked", 410);

      if (request.method === "GET" && rest === "meta") {
        if (!(await authorize(record.readTokenDigest, request))) {
          return unauthorized();
        }
        return json(toMetadata(record));
      }

      if (request.method === "POST" && rest === "revisions") {
        if (!(await authorize(record.updateTokenDigest, request))) {
          return unauthorized();
        }
        const next = reserveEnvironmentRevision(
          record,
          reserveRevisionRequestSchema.parse(
            await readJson(request, 8 * 1024 * 1024),
          ),
          new Date(),
        );
        await this.state.storage.put("record", next);
        return json(toMetadata(next), 201);
      }

      const manifestMatch = /^revisions\/([^/]+)\/manifest$/u.exec(rest);
      if (manifestMatch?.[1] !== undefined) {
        const revisionId = decodeURIComponent(manifestMatch[1]);
        if (request.method === "PUT") {
          if (!(await authorize(record.updateTokenDigest, request))) {
            return unauthorized();
          }
          const bytes = await readBoundedBytes(request, MAX_CIPHERTEXT_BYTES);
          const descriptor = await descriptorFor(bytes);
          const next = recordEnvironmentManifest(
            record,
            revisionId,
            descriptor,
            new Date(),
          );
          const capacity = await this.reserveBytes(next);
          if (capacity !== undefined) return capacity;
          await this.storeBytes(manifestPrefix(revisionId), bytes);
          await this.state.storage.put("record", next);
          return json(toMetadata(next));
        }
        if (request.method === "GET") {
          if (!(await authorize(record.readTokenDigest, request))) {
            return unauthorized();
          }
          const revision = record.revisions[revisionId];
          if (revision?.status !== "committed") {
            return notFound("Committed revision not found");
          }
          return this.download(manifestPrefix(revisionId), revision.request.manifest);
        }
      }

      const commitMatch = /^revisions\/([^/]+)\/commit$/u.exec(rest);
      if (request.method === "POST" && commitMatch?.[1] !== undefined) {
        if (!(await authorize(record.updateTokenDigest, request))) {
          return unauthorized();
        }
        const next = commitEnvironmentRevision(
          record,
          decodeURIComponent(commitMatch[1]),
          new Date(),
        );
        await this.state.storage.put("record", next);
        return json(toMetadata(next));
      }

      const blobMatch = /^blobs\/([^/]+)$/u.exec(rest);
      if (blobMatch?.[1] !== undefined) {
        const blobId = decodeURIComponent(blobMatch[1]);
        if (request.method === "PUT") {
          if (!(await authorize(record.updateTokenDigest, request))) {
            return unauthorized();
          }
          const bytes = await readBoundedBytes(request, MAX_CIPHERTEXT_BYTES);
          const descriptor = await descriptorFor(bytes);
          const next = recordEnvironmentBlob(
            record,
            blobId,
            descriptor,
            new Date(),
          );
          const capacity = await this.reserveBytes(next);
          if (capacity !== undefined) return capacity;
          await this.storeBytes(blobPrefix(blobId), bytes);
          await this.state.storage.put("record", next);
          return json(toMetadata(next));
        }
        if (request.method === "GET") {
          if (!(await authorize(record.readTokenDigest, request))) {
            return unauthorized();
          }
          const committed = Object.values(record.revisions).some(
            (revision) =>
              revision.status === "committed" &&
              revision.request.blobs.some((blob) => blob.blobId === blobId),
          );
          if (!committed) return notFound("Environment blob is not committed");
          const descriptor = record.blobs[blobId];
          if (descriptor === undefined) return notFound();
          return this.download(blobPrefix(blobId), descriptor);
        }
      }

      if (rest === "proposals") {
        if (request.method === "POST") {
          if (
            record.proposalTokenDigest === undefined ||
            !(await authorize(record.proposalTokenDigest, request))
          ) {
            return unauthorized();
          }
          const body = asObject(await readJson(request, MAX_JSON_BODY));
          const descriptor = proposalDescriptorSchema.parse(body.descriptor);
          if (typeof body.ciphertextBase64 !== "string") {
            return error("BAD_REQUEST", "Missing proposal ciphertext", 400);
          }
          const bytes = Uint8Array.from(
            Buffer.from(body.ciphertextBase64, "base64"),
          );
          const actual = await descriptorFor(bytes);
          if (
            actual.ciphertextBytes !== descriptor.ciphertextBytes ||
            actual.ciphertextSha256 !== descriptor.ciphertextSha256
          ) {
            return error(
              "CONFLICT",
              "Proposal ciphertext descriptor mismatch",
              409,
            );
          }
          const next = addEnvironmentProposal(record, descriptor, new Date());
          const capacity = await this.reserveBytes(next);
          if (capacity !== undefined) return capacity;
          await this.storeBytes(proposalPrefix(descriptor.proposalId), bytes);
          await this.state.storage.put("record", next);
          return json(toMetadata(next), 201);
        }
        if (request.method === "GET") {
          if (!(await authorize(record.inboxTokenDigest, request))) {
            return unauthorized();
          }
          return json(
            proposalListResponseSchema.parse({
              proposals: Object.values(record.proposals).sort((left, right) =>
                left.descriptor.proposalId.localeCompare(
                  right.descriptor.proposalId,
                  "en",
                ),
              ),
            }),
          );
        }
      }

      const proposalMatch = /^proposals\/([^/]+)$/u.exec(rest);
      if (request.method === "GET" && proposalMatch?.[1] !== undefined) {
        if (!(await authorize(record.inboxTokenDigest, request))) {
          return unauthorized();
        }
        const proposalId = decodeURIComponent(proposalMatch[1]);
        const proposal = record.proposals[proposalId];
        if (proposal === undefined) return notFound("Proposal not found");
        return this.download(proposalPrefix(proposalId), proposal.descriptor);
      }

      const proposalStatusMatch = /^proposals\/([^/]+)\/status$/u.exec(rest);
      if (request.method === "POST" && proposalStatusMatch?.[1] !== undefined) {
        if (!(await authorize(record.inboxTokenDigest, request))) {
          return unauthorized();
        }
        const body = proposalStatusRequestSchema.parse(
          await readJson(request, 64 * 1024),
        );
        const next = setEnvironmentProposalStatus(
          record,
          decodeURIComponent(proposalStatusMatch[1]),
          body.status,
          new Date(),
        );
        await this.state.storage.put("record", next);
        return json(toMetadata(next));
      }

      return notFound();
    } catch (caught) {
      return mapError(caught);
    }
  }

  private async create(
    request: CreateEnvironmentRequest,
    rawRequest: Request,
  ): Promise<Response> {
    const existing = await this.state.storage.get<EnvironmentRecord>("record");
    if (existing !== undefined) {
      const active =
        effectiveEnvironmentStatus(existing, new Date()) === "active";
      const same =
        existing.readTokenDigest === request.readTokenDigest &&
        existing.updateTokenDigest === request.updateTokenDigest &&
        existing.proposalTokenDigest === request.proposalTokenDigest &&
        existing.inboxTokenDigest === request.inboxTokenDigest &&
        existing.revokeTokenDigest === request.revokeTokenDigest;
      return active && same
        ? json(toMetadata(existing))
        : error("CONFLICT", "Environment ID already exists", 409);
    }
    const record = createEnvironmentRecord(request, new Date());
    const actorDigest =
      this.env === undefined ? undefined : internalActorDigest(rawRequest);
    if (actorDigest !== undefined) {
      const capacity = await this.reserveActive(record, actorDigest);
      if (capacity !== undefined) return capacity;
      await this.state.storage.put("actorDigest", actorDigest);
    }
    await this.state.storage.setAlarm(Date.parse(record.expiresAt));
    await this.state.storage.put("record", record);
    return json(toMetadata(record), 201);
  }

  private async requiredRecord(
    environmentId: string,
  ): Promise<EnvironmentRecord> {
    const record = await this.state.storage.get<EnvironmentRecord>("record");
    if (record?.environmentId !== environmentId) {
      throw new EnvironmentStateError("NOT_FOUND", "Environment not found");
    }
    return record;
  }

  private async storeBytes(prefix: string, bytes: Uint8Array): Promise<void> {
    const existing = await this.state.storage.list({ prefix });
    if (existing.size > 0)
      await this.state.storage.delete([...existing.keys()]);
    const values: Record<string, Uint8Array> = {};
    let index = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
      values[`${prefix}${String(index).padStart(5, "0")}`] = bytes.slice(
        offset,
        Math.min(offset + CHUNK_BYTES, bytes.byteLength),
      );
      index += 1;
    }
    if (Object.keys(values).length > 0) await this.state.storage.put(values);
  }

  private download(prefix: string, descriptor: CiphertextDescriptor): Response {
    const storage = this.state.storage;
    const count = Math.ceil(descriptor.ciphertextBytes / CHUNK_BYTES);
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (index >= count) {
          controller.close();
          return;
        }
        const chunk = await storage.get<Uint8Array>(
          `${prefix}${String(index).padStart(5, "0")}`,
        );
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
        "content-length": String(descriptor.ciphertextBytes),
        "cache-control": "no-store",
      },
    });
  }

  private async deletePayloads(): Promise<void> {
    for (const prefix of ["manifest:", "blob:", "proposal:"]) {
      const values = await this.state.storage.list({ prefix });
      if (values.size > 0) await this.state.storage.delete([...values.keys()]);
    }
  }

  private async reserveActive(
    record: EnvironmentRecord,
    actorDigest: string,
  ): Promise<Response | undefined> {
    const control = this.control();
    if (control === undefined) return undefined;
    const response = await control.fetch(
      new Request(`https://control/v1/reservations/${record.environmentId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actorDigest, expiresAt: record.expiresAt }),
      }),
    );
    return response.ok
      ? undefined
      : error(
          "CAPACITY",
          "Public relay is at active-environment capacity",
          503,
        );
  }

  private async reserveBytes(
    record: EnvironmentRecord,
  ): Promise<Response | undefined> {
    const control = this.control();
    if (control === undefined) return undefined;
    const bytes = totalCiphertextBytes(record);
    if (bytes <= 0) return undefined;
    const actorDigest = await this.ownerActorDigest();
    const response = await control.fetch(
      new Request(`https://control/v1/reservations/${record.environmentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorDigest,
          bytes,
          expiresAt: record.expiresAt,
        }),
      }),
    );
    return response.ok
      ? undefined
      : error("CAPACITY", "Public relay is at ciphertext capacity", 503);
  }

  private async releaseCapacity(environmentId: string): Promise<boolean> {
    const control = this.control();
    if (control === undefined) return true;
    return (
      await control.fetch(
        new Request(`https://control/v1/reservations/${environmentId}`, {
          method: "DELETE",
        }),
      )
    ).ok;
  }

  private control(): DurableObjectStub | undefined {
    return this.env?.CONTROL.get(this.env.CONTROL.idFromName("global"));
  }

  private async ownerActorDigest(): Promise<string> {
    const actorDigest = await this.state.storage.get<string>("actorDigest");
    if (actorDigest === undefined || !isActorDigest(actorDigest)) {
      throw new Error("Missing environment owner actor identity");
    }
    return actorDigest;
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
}

function totalCiphertextBytes(record: EnvironmentRecord): number {
  const manifests = Object.values(record.revisions).reduce(
    (total, revision) =>
      total +
      (revision.manifestUploaded
        ? revision.request.manifest.ciphertextBytes
        : 0),
    0,
  );
  const blobs = Object.values(record.blobs).reduce(
    (total, descriptor) => total + descriptor.ciphertextBytes,
    0,
  );
  const proposals = Object.values(record.proposals).reduce(
    (total, proposal) => total + proposal.descriptor.ciphertextBytes,
    0,
  );
  return manifests + blobs + proposals;
}

function internalActorDigest(request: Request): string {
  const value = request.headers.get(ACTOR_HEADER);
  if (!isActorDigest(value))
    throw new BadRequestError("Missing actor identity");
  return value;
}

function isActorDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
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

async function descriptorFor(bytes: Uint8Array): Promise<CiphertextDescriptor> {
  return {
    ciphertextSha256: await sha256Hex(bytes),
    ciphertextBytes: bytes.byteLength,
  };
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
  return Uint8Array.from(Buffer.concat(chunks, total));
}

function manifestPrefix(revisionId: string): string {
  return `manifest:${revisionId}:`;
}

function blobPrefix(blobId: string): string {
  return `blob:${blobId}:`;
}

function proposalPrefix(proposalId: string): string {
  return `proposal:${proposalId}:`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestError("Expected object");
  }
  return value as Record<string, unknown>;
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
  if (caught instanceof EnvironmentStateError) {
    const statuses = {
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

function notFound(message = "Route not found"): Response {
  return error("NOT_FOUND", message, 404);
}

function unauthorized(): Response {
  return error("UNAUTHORIZED", "Invalid capability", 401);
}

class BadRequestError extends Error {}
class PayloadTooLargeError extends Error {
  constructor() {
    super("Ciphertext exceeds relay limit");
  }
}
