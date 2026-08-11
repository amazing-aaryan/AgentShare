import {
  decodeAcb,
  decryptBundle,
  keyFromFragment,
  parseShareUrl,
} from "@agentshare/acb";
import type { AcbManifest, AuthoritativeMetadata } from "@agentshare/contracts";
import { RelayClient } from "./relay-client.js";

export async function openShare(link: string): Promise<{
  manifest: AcbManifest;
  metadata: AuthoritativeMetadata;
}> {
  const parsed = parseShareUrl(link);
  const client = new RelayClient(new URL(parsed.safeUrl).origin);
  const response = await client.metadata(parsed.shareId, parsed.readCapability);
  const envelope = await client.download(parsed.shareId, parsed.readCapability);
  const manifest = decodeAcb(
    decryptBundle(
      envelope,
      response.metadata,
      keyFromFragment(parsed.fragmentKey),
    ),
  );
  return { manifest, metadata: response.metadata };
}
