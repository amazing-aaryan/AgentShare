import { z } from "zod";
import {
  MAX_CIPHERTEXT_BYTES,
  MAX_TTL_SECONDS,
  sha256Schema,
} from "./index.js";

const objectIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{19,99}$/u);

export const ciphertextDescriptorSchema = z.object({
  ciphertextSha256: sha256Schema,
  ciphertextBytes: z.number().int().positive().max(MAX_CIPHERTEXT_BYTES),
});

export const environmentBlobDescriptorSchema = z.object({
  blobId: objectIdSchema,
  ...ciphertextDescriptorSchema.shape,
});

export const createEnvironmentRequestSchema = z.object({
  environmentId: objectIdSchema,
  requestedTtlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS),
  readTokenDigest: sha256Schema,
  updateTokenDigest: sha256Schema,
  proposalTokenDigest: sha256Schema.optional(),
  inboxTokenDigest: sha256Schema,
  revokeTokenDigest: sha256Schema,
});

export const reserveRevisionRequestSchema = z
  .object({
    revisionId: objectIdSchema,
    parentRevisionId: objectIdSchema.optional(),
    manifest: ciphertextDescriptorSchema,
    blobs: z.array(environmentBlobDescriptorSchema).max(20_000),
  })
  .superRefine((value, context) => {
    if (value.parentRevisionId === value.revisionId) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionId"],
        message: "Parent revision must differ from revision",
      });
    }
    const ids = new Set<string>();
    for (const [index, blob] of value.blobs.entries()) {
      if (ids.has(blob.blobId)) {
        context.addIssue({
          code: "custom",
          path: ["blobs", index, "blobId"],
          message: "Duplicate blob id",
        });
      }
      ids.add(blob.blobId);
    }
  });

export const environmentStatusSchema = z.enum(["active", "revoked", "expired"]);
export const revisionStatusSchema = z.enum(["awaiting-blobs", "committed"]);
export const proposalStatusSchema = z.enum(["pending", "accepted", "rejected"]);

export const proposalStatusRequestSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
});

export const proposalDescriptorSchema = z.object({
  proposalId: objectIdSchema,
  baseRevisionId: objectIdSchema,
  ciphertextSha256: sha256Schema,
  ciphertextBytes: z.number().int().positive().max(MAX_CIPHERTEXT_BYTES),
  ephemeralPublicKey: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/u),
  createdAt: z.iso.datetime().optional(),
});

export const environmentMetadataSchema = z.object({
  protocolVersion: z.literal("agentshare-environment-relay-v2"),
  environmentId: objectIdSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: environmentStatusSchema,
  currentRevisionId: objectIdSchema.nullable(),
  limits: z.object({
    maxCiphertextBytes: z.number().int().positive(),
    maxTtlSeconds: z.number().int().positive(),
  }),
});

export const environmentMetadataResponseSchema =
  environmentMetadataSchema.extend({
    currentRevision: z
      .object({
        revisionId: objectIdSchema,
        parentRevisionId: objectIdSchema.optional(),
        manifest: ciphertextDescriptorSchema,
        blobs: z.array(environmentBlobDescriptorSchema),
      })
      .nullable(),
  });

export const proposalListResponseSchema = z.object({
  proposals: z.array(
    z.object({
      descriptor: proposalDescriptorSchema,
      status: proposalStatusSchema,
    }),
  ),
});

export type CiphertextDescriptor = z.infer<typeof ciphertextDescriptorSchema>;
export type EnvironmentBlobDescriptor = z.infer<
  typeof environmentBlobDescriptorSchema
>;
export type CreateEnvironmentRequest = z.infer<
  typeof createEnvironmentRequestSchema
>;
export type ReserveRevisionRequest = z.infer<
  typeof reserveRevisionRequestSchema
>;
export type ProposalDescriptor = z.infer<typeof proposalDescriptorSchema>;
export type EnvironmentMetadata = z.infer<typeof environmentMetadataSchema>;
export type EnvironmentMetadataResponse = z.infer<
  typeof environmentMetadataResponseSchema
>;
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;
export type RevisionStatus = z.infer<typeof revisionStatusSchema>;
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
