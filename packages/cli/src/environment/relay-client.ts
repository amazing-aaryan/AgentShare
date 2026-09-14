import {
  createEnvironmentRequestSchema,
  environmentMetadataResponseSchema,
  proposalDescriptorSchema,
  proposalListResponseSchema,
  reserveRevisionRequestSchema,
  type CreateEnvironmentRequest,
  type EnvironmentMetadataResponse,
  type ProposalDescriptor,
  type ReserveRevisionRequest,
} from "@agentshare/contracts";

export class EnvironmentRelayClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EnvironmentRelayClientError";
  }
}

export class EnvironmentRelayClient {
  readonly #origin: string;
  readonly #fetch: typeof fetch;

  constructor(origin: string, fetchImpl: typeof fetch = fetch) {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopback(url.hostname))
    ) {
      throw new Error("AgentShare relays require HTTPS except on loopback");
    }
    if (
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== "/"
    ) {
      throw new Error(
        "AgentShare relay must be an origin without credentials, path, query or fragment",
      );
    }
    this.#origin = url.origin;
    this.#fetch = fetchImpl;
  }

  get origin(): string {
    return this.#origin;
  }

  async create(
    request: CreateEnvironmentRequest,
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request("/v2/environments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createEnvironmentRequestSchema.parse(request)),
      }),
    );
  }

  async metadata(
    environmentId: string,
    readCapability: string,
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/meta`,
        {
          headers: auth(readCapability),
        },
      ),
    );
  }

  async reserveRevision(
    environmentId: string,
    updateCapability: string,
    request: ReserveRevisionRequest,
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/revisions`,
        {
          method: "POST",
          headers: {
            ...auth(updateCapability),
            "content-type": "application/json",
          },
          body: JSON.stringify(reserveRevisionRequestSchema.parse(request)),
        },
      ),
    );
  }

  async uploadManifest(
    environmentId: string,
    revisionId: string,
    updateCapability: string,
    bytes: Uint8Array,
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/revisions/${encodeURIComponent(revisionId)}/manifest`,
        {
          method: "PUT",
          headers: auth(updateCapability),
          body: Buffer.from(bytes),
        },
      ),
    );
  }

  async uploadBlob(
    environmentId: string,
    blobId: string,
    updateCapability: string,
    bytes: Uint8Array,
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/blobs/${encodeURIComponent(blobId)}`,
        {
          method: "PUT",
          headers: auth(updateCapability),
          body: Buffer.from(bytes),
        },
      ),
    );
  }

  async commitRevision(
    environmentId: string,
    revisionId: string,
    updateCapability: string,
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/revisions/${encodeURIComponent(revisionId)}/commit`,
        { method: "POST", headers: auth(updateCapability) },
      ),
    );
  }

  async downloadManifest(
    environmentId: string,
    revisionId: string,
    readCapability: string,
  ): Promise<Uint8Array> {
    return this.#bytes(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/revisions/${encodeURIComponent(revisionId)}/manifest`,
        { headers: auth(readCapability) },
      ),
    );
  }

  async downloadBlob(
    environmentId: string,
    blobId: string,
    readCapability: string,
  ): Promise<Uint8Array> {
    return this.#bytes(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/blobs/${encodeURIComponent(blobId)}`,
        { headers: auth(readCapability) },
      ),
    );
  }

  async submitProposal(
    environmentId: string,
    proposalCapability: string,
    descriptor: ProposalDescriptor,
    bytes: Uint8Array,
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/proposals`,
        {
          method: "POST",
          headers: {
            ...auth(proposalCapability),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            descriptor: proposalDescriptorSchema.parse(descriptor),
            ciphertextBase64: Buffer.from(bytes).toString("base64"),
          }),
        },
      ),
    );
  }

  async listProposals(environmentId: string, inboxCapability: string) {
    const response = await this.#request(
      `/v2/environments/${encodeURIComponent(environmentId)}/proposals`,
      { headers: auth(inboxCapability) },
    );
    await ensureOk(response);
    return proposalListResponseSchema.parse(await response.json()).proposals;
  }

  async downloadProposal(
    environmentId: string,
    proposalId: string,
    inboxCapability: string,
  ): Promise<Uint8Array> {
    return this.#bytes(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/proposals/${encodeURIComponent(proposalId)}`,
        { headers: auth(inboxCapability) },
      ),
    );
  }

  async setProposalStatus(
    environmentId: string,
    proposalId: string,
    inboxCapability: string,
    status: "accepted" | "rejected",
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}/proposals/${encodeURIComponent(proposalId)}/status`,
        {
          method: "POST",
          headers: {
            ...auth(inboxCapability),
            "content-type": "application/json",
          },
          body: JSON.stringify({ status }),
        },
      ),
    );
  }

  async revoke(
    environmentId: string,
    revokeCapability: string,
  ): Promise<EnvironmentMetadataResponse> {
    return this.#metadata(
      await this.#request(
        `/v2/environments/${encodeURIComponent(environmentId)}`,
        {
          method: "DELETE",
          headers: auth(revokeCapability),
        },
      ),
    );
  }

  #request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.#fetch(`${this.#origin}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  }

  async #metadata(response: Response): Promise<EnvironmentMetadataResponse> {
    await ensureOk(response);
    return environmentMetadataResponseSchema.parse(await response.json());
  }

  async #bytes(response: Response): Promise<Uint8Array> {
    await ensureOk(response);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 50 * 1024 * 1024) {
      throw new EnvironmentRelayClientError(
        413,
        "Ciphertext exceeds client limit",
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 50 * 1024 * 1024) {
      throw new EnvironmentRelayClientError(
        413,
        "Ciphertext exceeds client limit",
      );
    }
    return bytes;
  }
}

function auth(capability: string): Record<string, string> {
  return { authorization: `Bearer ${capability}` };
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let message = `Relay returned HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message !== undefined) message = body.error.message;
  } catch {
    // Preserve status-only fallback.
  }
  throw new EnvironmentRelayClientError(response.status, message);
}
