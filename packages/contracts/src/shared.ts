import { z } from "zod";

export const MAX_CIPHERTEXT_BYTES = 50 * 1024 * 1024;
export const MAX_RESOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_TTL_SECONDS = 72 * 60 * 60;

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
