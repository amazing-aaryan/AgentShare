import { z } from "zod";
import { sharedWorkspacePathSchema } from "./environment.js";
import { sha256Schema } from "./index.js";

const proposalIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{19,99}$/u);

const createOperationSchema = z.object({
  type: z.literal("create"),
  path: sharedWorkspacePathSchema,
  newSha256: sha256Schema,
  mediaType: z.string().min(1).max(200),
  contentBase64: z.string(),
});

const replaceOperationSchema = z.object({
  type: z.literal("replace"),
  path: sharedWorkspacePathSchema,
  baseSha256: sha256Schema,
  newSha256: sha256Schema,
  mediaType: z.string().min(1).max(200),
  contentBase64: z.string(),
});

const deleteOperationSchema = z.object({
  type: z.literal("delete"),
  path: sharedWorkspacePathSchema,
  baseSha256: sha256Schema,
});

export const proposalOperationSchema = z.discriminatedUnion("type", [
  createOperationSchema,
  replaceOperationSchema,
  deleteOperationSchema,
]);

export const proposalSchema = z
  .object({
    version: z.literal("agentshare-proposal-v1"),
    proposalId: proposalIdSchema,
    environmentId: proposalIdSchema,
    baseRevisionId: proposalIdSchema,
    createdAt: z.iso.datetime(),
    summary: z.string().min(1).max(500),
    operations: z.array(proposalOperationSchema).min(1).max(500),
  })
  .superRefine((value, context) => {
    const paths = new Set<string>();
    for (const [index, operation] of value.operations.entries()) {
      if (paths.has(operation.path)) {
        context.addIssue({
          code: "custom",
          path: ["operations", index, "path"],
          message: "Proposal may modify each path at most once",
        });
      }
      paths.add(operation.path);
      if ("contentBase64" in operation) {
        try {
          Buffer.from(operation.contentBase64, "base64");
        } catch {
          context.addIssue({
            code: "custom",
            path: ["operations", index, "contentBase64"],
            message: "Invalid base64 file content",
          });
        }
      }
    }
  });

export type ProposalOperation = z.infer<typeof proposalOperationSchema>;
export type AgentShareProposal = z.infer<typeof proposalSchema>;
