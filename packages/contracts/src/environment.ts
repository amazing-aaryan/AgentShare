import { z } from "zod";
import { sessionEventSchema, sha256Schema } from "./index.js";

const objectIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{19,99}$/u);

export const sharedWorkspacePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .superRefine((value, context) => {
    if (value.includes("\\")) {
      context.addIssue({ code: "custom", message: "Workspace paths must use forward slashes" });
      return;
    }
    if (value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) {
      context.addIssue({ code: "custom", message: "Workspace paths must be relative" });
      return;
    }
    const parts = value.split("/");
    if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
      context.addIssue({ code: "custom", message: "Workspace path is not normalized" });
      return;
    }
    if (parts[0] === ".git" || parts[0] === ".agentshare") {
      context.addIssue({ code: "custom", message: "Reserved workspace path" });
    }
  });

export const environmentBlobReferenceSchema = z.object({
  blobId: objectIdSchema,
  byteOffset: z.number().int().nonnegative(),
  byteLength: z.number().int().positive(),
});

export const sharedFileSchema = z.object({
  resourceId: objectIdSchema,
  path: sharedWorkspacePathSchema,
  mediaType: z.string().min(1).max(200),
  byteLength: z.number().int().nonnegative(),
  sha256: sha256Schema,
  executable: z.boolean(),
  blobs: z.array(environmentBlobReferenceSchema).min(1),
});

export const environmentManifestSchema = z
  .object({
    version: z.literal("agentshare-environment-v2"),
    environmentId: objectIdSchema,
    revisionId: objectIdSchema,
    parentRevisionId: objectIdSchema.optional(),
    createdAt: z.iso.datetime(),
    title: z.string().min(1).max(200),
    sourceAgent: z.enum(["codex", "claude"]),
    conversation: z.object({ events: z.array(sessionEventSchema) }),
    workspace: z.object({
      rootName: z.string().min(1).max(255),
      files: z.array(sharedFileSchema),
    }),
    proposalPolicy: z.discriminatedUnion("enabled", [
      z.object({ enabled: z.literal(false) }),
      z.object({
        enabled: z.literal(true),
        encryptionPublicKey: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/u),
      }),
    ]),
  })
  .superRefine((value, context) => {
    if (value.parentRevisionId === value.revisionId) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionId"],
        message: "Parent revision must differ from revision",
      });
    }
    const paths = new Set<string>();
    for (const [index, file] of value.workspace.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: "custom",
          path: ["workspace", "files", index, "path"],
          message: "Duplicate workspace path",
        });
      }
      paths.add(file.path);
      const total = file.blobs.reduce((sum, blob) => sum + blob.byteLength, 0);
      if (total !== file.byteLength) {
        context.addIssue({
          code: "custom",
          path: ["workspace", "files", index, "blobs"],
          message: "Blob lengths must equal file byte length",
        });
      }
    }
  });

export type SharedWorkspacePath = z.infer<typeof sharedWorkspacePathSchema>;
export type SharedFile = z.infer<typeof sharedFileSchema>;
export type EnvironmentManifest = z.infer<typeof environmentManifestSchema>;
