import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { sha256Hex } from "./canonical.js";

const MAGIC = Buffer.from("ASP1", "ascii");
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.byteLength + NONCE_BYTES + TAG_BYTES;

export type ProposalKeyPair = { publicKey: string; privateKey: string };

export type ProposalEncryptionContext = {
  environmentId: string;
  proposalId: string;
};

export type EncryptedProposal = ProposalEncryptionContext & {
  ephemeralPublicKey: string;
  envelope: Uint8Array;
  ciphertextSha256: string;
};

export function generateProposalKeyPair(): ProposalKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url"),
    privateKey: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64url"),
  };
}

export function encryptProposalForOwner(
  plaintext: Uint8Array,
  ownerPublicKey: string,
  context: ProposalEncryptionContext,
): EncryptedProposal {
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: decodePublicKey(ownerPublicKey),
  });
  const key = deriveProposalKey(shared, context);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(proposalAad(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([MAGIC, nonce, tag, ciphertext]);
  return {
    ...context,
    ephemeralPublicKey: ephemeral.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url"),
    envelope,
    ciphertextSha256: sha256Hex(envelope),
  };
}

export function decryptProposalForOwner(
  encrypted: EncryptedProposal,
  ownerPrivateKey: string,
): Uint8Array {
  const envelope = Buffer.from(encrypted.envelope);
  if (envelope.byteLength < HEADER_BYTES)
    throw new Error("Invalid AgentShare proposal envelope");
  const magic = envelope.subarray(0, MAGIC.byteLength);
  if (!timingSafeEqual(magic, MAGIC))
    throw new Error("Unknown AgentShare proposal envelope version");
  const shared = diffieHellman({
    privateKey: decodePrivateKey(ownerPrivateKey),
    publicKey: decodePublicKey(encrypted.ephemeralPublicKey),
  });
  const context = {
    environmentId: encrypted.environmentId,
    proposalId: encrypted.proposalId,
  };
  const nonce = envelope.subarray(
    MAGIC.byteLength,
    MAGIC.byteLength + NONCE_BYTES,
  );
  const tag = envelope.subarray(MAGIC.byteLength + NONCE_BYTES, HEADER_BYTES);
  const ciphertext = envelope.subarray(HEADER_BYTES);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveProposalKey(shared, context),
    nonce,
  );
  decipher.setAAD(proposalAad(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function deriveProposalKey(
  shared: Uint8Array,
  context: ProposalEncryptionContext,
): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(shared),
      Buffer.from(context.environmentId, "utf8"),
      Buffer.from(`agentshare/proposal/${context.proposalId}`, "utf8"),
      KEY_BYTES,
    ),
  );
}

function proposalAad(context: ProposalEncryptionContext): Buffer {
  return Buffer.from(
    JSON.stringify({ protocol: "agentshare-proposal-v1", ...context }),
    "utf8",
  );
}

function decodePublicKey(value: string) {
  return createPublicKey({
    key: Buffer.from(value, "base64url"),
    type: "spki",
    format: "der",
  });
}

function decodePrivateKey(value: string) {
  return createPrivateKey({
    key: Buffer.from(value, "base64url"),
    type: "pkcs8",
    format: "der",
  });
}
