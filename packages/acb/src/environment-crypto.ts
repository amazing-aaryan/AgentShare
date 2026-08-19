import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { sha256Hex } from "./canonical.js";

const MAGIC = Buffer.from("ASE2", "ascii");
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.byteLength + NONCE_BYTES + TAG_BYTES;

export type EnvironmentObjectKind = "manifest" | "blob" | "index";

export type EnvironmentObjectContext = {
  environmentId: string;
  revisionId: string;
  kind: EnvironmentObjectKind;
  objectId: string;
};

export type EncryptedEnvironmentObject = {
  envelope: Uint8Array;
  ciphertextSha256: string;
};

export function randomEnvironmentMasterKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function encryptEnvironmentObject(
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  context: EnvironmentObjectContext,
): EncryptedEnvironmentObject {
  const key = deriveEnvironmentObjectKey(masterKey, context);
  const nonce = randomBytes(NONCE_BYTES);
  const aad = canonicalEnvironmentAad(context);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([MAGIC, nonce, tag, ciphertext]);
  return { envelope, ciphertextSha256: sha256Hex(envelope) };
}

export function decryptEnvironmentObject(
  encrypted: Uint8Array,
  masterKey: Uint8Array,
  context: EnvironmentObjectContext,
): Uint8Array {
  const envelope = Buffer.from(encrypted);
  if (envelope.byteLength < HEADER_BYTES)
    throw new Error("Invalid AgentShare environment envelope");
  const magic = envelope.subarray(0, MAGIC.byteLength);
  if (!timingSafeEqual(magic, MAGIC))
    throw new Error("Unknown AgentShare environment envelope version");
  const nonce = envelope.subarray(
    MAGIC.byteLength,
    MAGIC.byteLength + NONCE_BYTES,
  );
  const tag = envelope.subarray(MAGIC.byteLength + NONCE_BYTES, HEADER_BYTES);
  const ciphertext = envelope.subarray(HEADER_BYTES);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveEnvironmentObjectKey(masterKey, context),
    nonce,
  );
  decipher.setAAD(canonicalEnvironmentAad(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function deriveEnvironmentObjectKey(
  masterKey: Uint8Array,
  context: EnvironmentObjectContext,
): Uint8Array {
  if (masterKey.byteLength !== KEY_BYTES)
    throw new RangeError("Environment master key must be 32 bytes");
  const info = Buffer.from(
    `agentshare/environment/${context.kind}/${context.revisionId}/${context.objectId}`,
    "utf8",
  );
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(masterKey),
      Buffer.from(context.environmentId, "utf8"),
      info,
      KEY_BYTES,
    ),
  );
}

function canonicalEnvironmentAad(context: EnvironmentObjectContext): Buffer {
  return Buffer.from(
    JSON.stringify({
      protocol: "agentshare-environment-v2",
      environmentId: context.environmentId,
      revisionId: context.revisionId,
      kind: context.kind,
      objectId: context.objectId,
    }),
    "utf8",
  );
}
