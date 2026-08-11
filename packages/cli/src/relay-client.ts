import {
  createShareRequestSchema,
  MAX_CIPHERTEXT_BYTES,
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
    const url = new URL(origin);
    if (url.protocol !== "https:" && !isLoopback(url.hostname)) {
      throw new Error("AgentShare relays require HTTPS except on loopback");
    }
    this.#origin = url.origin;
  }

  get origin(): string {
    return this.#origin;
  }

  async create(request: CreateShareRequest): Promise<ShareMetadataResponse> {
    const response = await relayFetch(`${this.#origin}/v1/shares`, {
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
    const response = await relayFetch(
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
    const response = await relayFetch(
      `${this.#origin}/v1/shares/${encodeURIComponent(shareId)}/meta`,
      { headers: { authorization: `Bearer ${readCapability}` } },
    );
    return this.#metadata(response);
  }

  async download(shareId: string, readCapability: string): Promise<Uint8Array> {
    const response = await relayFetch(
      `${this.#origin}/v1/shares/${encodeURIComponent(shareId)}/blob`,
      { headers: { authorization: `Bearer ${readCapability}` } },
    );
    await ensureOk(response);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_CIPHERTEXT_BYTES) {
      throw new RelayClientError(413, "Ciphertext exceeds client limit");
    }
    if (response.body === null)
      throw new RelayClientError(502, "Missing ciphertext body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CIPHERTEXT_BYTES) {
        await reader.cancel();
        throw new RelayClientError(413, "Ciphertext exceeds client limit");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  }

  async revoke(
    shareId: string,
    revokeCapability: string,
  ): Promise<ShareMetadataResponse> {
    const response = await relayFetch(
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

function relayFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
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
    // Preserve status-only fallback when relay body is not JSON.
  }
  throw new RelayClientError(response.status, message);
}
