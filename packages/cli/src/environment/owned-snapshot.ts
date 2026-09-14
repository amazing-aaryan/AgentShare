import { createHash } from "node:crypto";
import { decryptEnvironmentObject, keyFromFragment } from "@agentshare/acb";
import { environmentManifestSchema } from "@agentshare/contracts";
import type { WorkspaceSnapshot } from "../workspace/index.js";
import { prepareCapturedSnapshot, type PreparedCapture } from "./preview.js";
import type { OwnedEnvironment } from "./state.js";
import { EnvironmentRelayClient } from "./relay-client.js";

/** Hydrate only the authenticated committed share, never the owner's current files. */
export async function readOwnedSnapshot(
  owned: OwnedEnvironment,
  client = new EnvironmentRelayClient(owned.relayOrigin),
): Promise<PreparedCapture> {
  if (owned.currentRevisionId === null)
    throw new Error("Environment has no approved base snapshot");
  const metadata = await client.metadata(
    owned.environmentId,
    owned.readCapability,
  );
  if (
    metadata.currentRevisionId !== owned.currentRevisionId ||
    metadata.currentRevision == null
  ) {
    throw new Error("Shared base changed; reload before reviewing proposal");
  }
  const bytes =
    owned.committedManifestBase64 === undefined
      ? await client.downloadManifest(
          owned.environmentId,
          owned.currentRevisionId,
          owned.readCapability,
        )
      : Buffer.from(owned.committedManifestBase64, "base64");
  verify(bytes, metadata.currentRevision.manifest);
  const key = keyFromFragment(owned.environmentMasterKey);
  const manifest = environmentManifestSchema.parse(
    JSON.parse(
      Buffer.from(
        decryptEnvironmentObject(bytes, key, {
          environmentId: owned.environmentId,
          revisionId: owned.currentRevisionId,
          kind: "manifest",
          objectId: `manifest_${owned.currentRevisionId}`,
        }),
      ).toString("utf8"),
    ),
  );
  if (
    manifest.environmentId !== owned.environmentId ||
    manifest.revisionId !== owned.currentRevisionId
  ) {
    throw new Error("Shared base identity mismatch");
  }
  const snapshot: WorkspaceSnapshot = {
    root: owned.workspaceRoot,
    rootName: manifest.workspace.rootName,
    files: [],
    excluded: [],
    totalBytes: 0,
  };
  for (const file of manifest.workspace.files) {
    const chunks: Buffer[] = [];
    for (const reference of file.blobs) {
      const descriptor = metadata.currentRevision.blobs.find(
        (blob) => blob.blobId === reference.blobId,
      );
      if (descriptor === undefined)
        throw new Error("Shared base blob descriptor missing");
      const encrypted = await client.downloadBlob(
        owned.environmentId,
        reference.blobId,
        owned.readCapability,
      );
      verify(encrypted, descriptor);
      const plain = decryptEnvironmentObject(encrypted, key, {
        environmentId: owned.environmentId,
        revisionId: "shared-blobs",
        kind: "blob",
        objectId: reference.blobId,
      });
      if (reference.byteOffset + reference.byteLength > plain.byteLength)
        throw new Error("Shared base blob bounds invalid");
      chunks.push(
        Buffer.from(plain).subarray(
          reference.byteOffset,
          reference.byteOffset + reference.byteLength,
        ),
      );
    }
    const content = Buffer.concat(chunks);
    if (content.byteLength !== file.byteLength || hash(content) !== file.sha256)
      throw new Error("Shared base file integrity failed");
    snapshot.files.push({
      path: file.path,
      mediaType: file.mediaType,
      byteLength: file.byteLength,
      sha256: file.sha256,
      executable: file.executable,
      contentBase64: content.toString("base64"),
    });
    snapshot.totalBytes += content.byteLength;
  }
  const result = prepareCapturedSnapshot(
    {
      sourceAgent: manifest.sourceAgent,
      title: manifest.title,
      workspaceRoot: owned.workspaceRoot,
      conversation: manifest.conversation.events,
    },
    snapshot,
    {
      includeConversation: true,
      proposalsEnabled: owned.sharePolicy.proposalsEnabled,
    },
  );
  if (result.findings.length !== 0)
    throw new Error(
      "Existing shared snapshot fails current scanner policy; fresh owner review required",
    );
  return result;
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function verify(
  bytes: Uint8Array,
  descriptor: { ciphertextBytes: number; ciphertextSha256: string },
): void {
  if (
    bytes.byteLength !== descriptor.ciphertextBytes ||
    hash(bytes) !== descriptor.ciphertextSha256
  ) {
    throw new Error("Shared base ciphertext integrity failed");
  }
}
