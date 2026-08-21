import { z } from "zod";

export const PROTOCOL_VERSION = "agentshare-relay-v1" as const;
export const ACB_VERSION = "acb-v1" as const;
export const MAX_CIPHERTEXT_BYTES = 50 * 1024 * 1024;
export const MAX_RESOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_TTL_SECONDS = 72 * 60 * 60;
export const MAX_QUERY_MESSAGE_BYTES = 256 * 1024;

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u);

export const sessionEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  kind: z.enum(["message", "reasoning-summary", "tool-call", "tool-result"]),
  text: z.string(),
  sourceId: z.string().min(1),
  createdAt: z.iso.datetime().optional(),
});
export type SessionEvent = z.infer<typeof sessionEventSchema>;

export const resourceSchema = z.object({
  id: z.string().min(1),
  mediaType: z.string().min(1),
  byteLength: z.number().int().nonnegative().max(MAX_RESOURCE_BYTES),
  sha256: sha256Schema,
  contentBase64: z.string(),
  sourcePath: z.string().optional(),
});
export type AcbResource = z.infer<typeof resourceSchema>;

export const acbManifestSchema = z.object({
  version: z.literal(ACB_VERSION),
  title: z.string().min(1).max(200),
  sourceAgent: z.enum(["codex", "claude", "generic"]),
  exportedAt: z.iso.datetime(),
  events: z.array(sessionEventSchema),
  resources: z.array(resourceSchema),
});
export type AcbManifest = z.infer<typeof acbManifestSchema>;

export const relayLimitsSchema = z.object({
  maxCiphertextBytes: z.literal(MAX_CIPHERTEXT_BYTES),
  maxTtlSeconds: z.literal(MAX_TTL_SECONDS),
});
export type RelayLimits = z.infer<typeof relayLimitsSchema>;

export const createShareRequestSchema = z.object({
  shareId: base64UrlSchema.min(20).max(100),
  requestedTtlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS),
  uploadTokenDigest: sha256Schema,
  readTokenDigest: sha256Schema,
  revokeTokenDigest: sha256Schema,
});
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;

export const authoritativeMetadataSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  shareId: base64UrlSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  limits: relayLimitsSchema,
});
export type AuthoritativeMetadata = z.infer<typeof authoritativeMetadataSchema>;

export const uploadDescriptorSchema = z.object({
  ciphertextSha256: sha256Schema,
  ciphertextBytes: z.number().int().positive().max(MAX_CIPHERTEXT_BYTES),
});
export type UploadDescriptor = z.infer<typeof uploadDescriptorSchema>;

export const shareStatusSchema = z.enum([
  "awaiting-upload",
  "available",
  "revoked",
  "expired",
]);
export type ShareStatus = z.infer<typeof shareStatusSchema>;

export const shareMetadataResponseSchema = z.object({
  metadata: authoritativeMetadataSchema,
  status: shareStatusSchema,
  upload: uploadDescriptorSchema.optional(),
});
export type ShareMetadataResponse = z.infer<typeof shareMetadataResponseSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum([
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "NOT_FOUND",
      "CONFLICT",
      "EXPIRED",
      "REVOKED",
      "PAYLOAD_TOO_LARGE",
      "RATE_LIMITED",
      "CAPACITY",
      "INTERNAL",
    ]),
    message: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const mcpCitationSchema = z.object({
  sourceId: z.string(),
  sequence: z.number().int().nonnegative().optional(),
  resourceId: z.string().optional(),
  quote: z.string().max(500),
});

export const mcpQueryResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(mcpCitationSchema),
});
export type McpQueryResponse = z.infer<typeof mcpQueryResponseSchema>;

export type RelayRecord = {
  metadata: AuthoritativeMetadata;
  uploadTokenDigest: string;
  readTokenDigest: string;
  revokeTokenDigest: string;
  status: ShareStatus;
  upload?: UploadDescriptor;
};

export const QUERY_PROTOCOL_VERSION = "agentshare-query-v1" as const;
export const queryCreateRequestSchema = z.object({
  endpointId: base64UrlSchema.min(20).max(100),
  requestedTtlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS),
  requestUploadTokenDigest: sha256Schema,
  requestReadTokenDigest: sha256Schema,
  responseUploadTokenDigest: sha256Schema,
  responseReadTokenDigest: sha256Schema,
  revokeTokenDigest: sha256Schema,
});
export type QueryCreateRequest = z.infer<typeof queryCreateRequestSchema>;

export const queryMetadataSchema = z.object({
  protocolVersion: z.literal(QUERY_PROTOCOL_VERSION),
  endpointId: base64UrlSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type QueryMetadata = z.infer<typeof queryMetadataSchema>;

export const queryStatusSchema = z.enum([
  "awaiting-question",
  "question-available",
  "answer-available",
  "revoked",
  "expired",
]);
export type QueryStatus = z.infer<typeof queryStatusSchema>;

export const queryMessageSchema = z
  .object({
    id: base64UrlSchema.min(20).max(100),
    kind: z.enum(["question", "answer"]),
    question: z.string().min(1).max(20_000).optional(),
    answer: z.string().min(1).max(100_000).optional(),
    evidence: z
      .array(
        z.object({
          source: z.string().min(1).max(500),
          detail: z.string().min(1).max(2_000),
        }),
      )
      .max(100)
      .optional(),
    createdAt: z.iso.datetime(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "question" && value.question === undefined)
      ctx.addIssue({ code: "custom", message: "Question text required" });
    if (value.kind === "answer" && value.answer === undefined)
      ctx.addIssue({ code: "custom", message: "Answer text required" });
  });
export type QueryMessage = z.infer<typeof queryMessageSchema>;
