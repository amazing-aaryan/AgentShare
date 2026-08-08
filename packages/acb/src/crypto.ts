import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { AuthoritativeMetadata } from "@agentshare/contracts";
import { canonicalAad, sha256Hex } from "./canonical.js";

const MAGIC = Buffer.from("AS1", "ascii");
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES + TAG_BYTES;

export type EncryptedBundle = {
  envelope: Uint8Array;
  key: Uint8Array;
  ciphertextSha256: string;
};

export function encryptBundle(
  plaintext: Uint8Array,
  metadata: AuthoritativeMetadata,
  key: Uint8Array = randomBytes(KEY_BYTES),
): EncryptedBundle {
  if (key.byteLength !== KEY_BYTES)
    throw new RangeError("AES-256 key must be 32 bytes");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(canonicalAad(metadata));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([MAGIC, nonce, tag, ciphertext]);
  return {
    envelope,
    key: Buffer.from(key),
    ciphertextSha256: sha256Hex(envelope),
  };
}

export function decryptBundle(
  envelopeBytes: Uint8Array,
  metadata: AuthoritativeMetadata,
  key: Uint8Array,
): Uint8Array {
  if (key.byteLength !== KEY_BYTES)
    throw new RangeError("AES-256 key must be 32 bytes");
  const envelope = Buffer.from(envelopeBytes);
  if (envelope.byteLength < HEADER_BYTES)
    throw new Error("Invalid AgentShare envelope");
  const magic = envelope.subarray(0, MAGIC.length);
  if (magic.byteLength !== MAGIC.length || !timingSafeEqual(magic, MAGIC)) {
    throw new Error("Unknown AgentShare envelope version");
  }
  const nonce = envelope.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
  const tag = envelope.subarray(
    MAGIC.length + NONCE_BYTES,
    MAGIC.length + NONCE_BYTES + TAG_BYTES,
  );
  const ciphertext = envelope.subarray(HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(canonicalAad(metadata));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function keyToFragment(key: Uint8Array): string {
  if (key.byteLength !== KEY_BYTES)
    throw new RangeError("AES-256 key must be 32 bytes");
  return Buffer.from(key).toString("base64url");
}

export function keyFromFragment(value: string): Uint8Array {
  const key = Buffer.from(value, "base64url");
  if (key.byteLength !== KEY_BYTES)
    throw new Error("Invalid AgentShare fragment key");
  return key;
}
