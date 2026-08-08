import {
  createShareRequestSchema,
  shareMetadataResponseSchema,
  type CreateShareRequest,
  type ShareMetadataResponse,
} from "@agentshare/contracts";

export class RelayClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RelayClientError";
  }
}

export class RelayClient {
  readonly #origin: string;

  constructor(origin: string) {
    this.#origin = new URL(origin).origin;
  }

  get origin(): string {
    return this.#origin;
  }

  async create(request: CreateShareRequest): Promise<ShareMetadataResponse> {
    const response = await fetch(`${this.#origin}/v1/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createShareRequestSchema.parse(request)),
    });
    return this.#metadata(response);
  }

  async upload(args: {
    shareId: string;
    uploadCapability: string;
    ciphertextSha256: string;
    envelope: Uint8Array;
  }): Promise<ShareMetadataResponse> {
    const response = await fetch(
      `${this.#origin}/v1/shares/${encodeURIComponent(args.shareId)}/blob`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${args.uploadCapability}`,
          "content-type": "application/octet-stream",
          "x-agentshare-sha256": args.ciphertextSha256,
        },
        body: Buffer.from(args.envelope),
      },
    );
    return this.#metadata(response);
  }

  async metadata(
    shareId: string,
    readCapability: string,
  ): Promise<ShareMetadataResponse> {
    const response = await fetch(
      `${this.#origin}/v1/shares/${encodeURIComponent(shareId)}/meta`,
      { headers: { authorization: `Bearer ${readCapability}` } },
    );
    return this.#metadata(response);
  }

  async download(shareId: string, readCapability: string): Promise<Uint8Array> {
    const response = await fetch(
      `${this.#origin}/v1/shares/${encodeURIComponent(shareId)}/blob`,
      { headers: { authorization: `Bearer ${readCapability}` } },
    );
    await ensureOk(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async revoke(
    shareId: string,
    revokeCapability: string,
  ): Promise<ShareMetadataResponse> {
    const response = await fetch(
      `${this.#origin}/v1/shares/${encodeURIComponent(shareId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${revokeCapability}` },
      },
    );
    return this.#metadata(response);
  }

  async #metadata(response: Response): Promise<ShareMetadataResponse> {
    await ensureOk(response);
    const body: unknown = await response.json();
    return shareMetadataResponseSchema.parse(body);
  }
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let message = `Relay returned HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message !== undefined) message = body.error.message;
  } catch {
    // Preserve status-only fallback when relay body is not JSON.
  }
  throw new RelayClientError(response.status, message);
}
