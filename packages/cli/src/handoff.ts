import {
  decodeAcb,
  decryptBundle,
  keyFromFragment,
  parseShareUrl,
  sha256Hex,
} from "@agentshare/acb";
import type { AcbManifest, AuthoritativeMetadata } from "@agentshare/contracts";
import { RelayClient } from "./relay-client.js";

export async function openShare(link: string): Promise<{
  manifest: AcbManifest;
  metadata: AuthoritativeMetadata;
}> {
  const parsed = parseShareUrl(link);
  const client = new RelayClient(parsed.relayOrigin);
  const response = await client.metadata(parsed.shareId, parsed.readCapability);
  const envelope = await client.download(parsed.shareId, parsed.readCapability);
  const descriptorMatches =
    response.upload?.ciphertextBytes === envelope.byteLength &&
    response.upload.ciphertextSha256 === sha256Hex(envelope);
  if (response.status !== "available" || !descriptorMatches) {
    throw new Error("Relay ciphertext descriptor mismatch");
  }
  const manifest = decodeAcb(
    decryptBundle(
      envelope,
      response.metadata,
      keyFromFragment(parsed.fragmentKey),
    ),
  );
  return { manifest, metadata: response.metadata };
}
