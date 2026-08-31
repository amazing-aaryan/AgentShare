import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { exportCurrentCodexCapture } from "@agentshare/adapter-codex";
import {
  reviewPayload,
  classifyResourceContent,
  scanText,
} from "@agentshare/scanner";
import {
  prepareShareDraft,
  readShareDraft,
  commitShareDraft,
  shareDraftStatus,
  type DraftOptions,
  type DraftReview,
  type DraftTarget,
} from "./environment/drafts.js";
import { findOwnedEnvironment } from "./environment/state.js";
import {
  prepareOwnedProposalReview,
  approveOwnedProposal,
} from "./proposals/apply.js";
import { revokeOwnedEnvironment } from "./commands/runtime-v2.js";
import { renderProposalDiff } from "./tui/proposal-review.js";
import { listOwnedProposals } from "./proposals/inbox.js";
import { sanitizeTerminalText } from "./terminal.js";

const RELAY = "https://agentshare-relay.carnation-vermicelli.workers.dev";
const HANDOFF = "https://agentshare-handoff.carnation-vermicelli.workers.dev";
const string = { type: "string" };
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly: boolean,
) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: readOnly,
    destructiveHint: name === "revoke_share",
    idempotentHint: readOnly,
    openWorldHint: true,
  },
});
export const CREATOR_TOOLS = [
  tool(
    "resolve_creator_session",
    "Resolve an explicit current Codex thread ID. Never guess the latest session.",
    { threadId: string },
    ["threadId"],
    true,
  ),
  tool(
    "prepare_share",
    "Capture and scan once locally. This does not publish. Review before commit.",
    {
      sessionRef: string,
      scope: { enum: ["conversation", "workspace", "both"] },
      access: { enum: ["read", "read_propose"] },
      ttlSeconds: { type: "integer", minimum: 1, maximum: 259200 },
      workspaceRootOverride: string,
      environmentId: string,
      expectedBaseRevisionId: string,
    },
    ["sessionRef", "scope", "access", "ttlSeconds"],
    false,
  ),
  tool(
    "review_share",
    "Read bounded sanitized content from the immutable draft. No owner private files are read.",
    {
      draftId: string,
      digest: string,
      section: {
        enum: ["summary", "conversation", "files", "exclusions", "redactions"],
      },
      cursor: { type: "integer", minimum: 0 },
    },
    ["draftId", "digest", "section"],
    true,
  ),
  tool(
    "commit_share",
    "Request native human confirmation of the exact draft, then publish. No argument can approve this action.",
    { draftId: string, digest: string },
    ["draftId", "digest"],
    false,
  ),
  tool(
    "share_status",
    "Inspect a draft publication/recovery state without publishing.",
    { draftId: string },
    ["draftId"],
    true,
  ),
  tool(
    "list_proposals",
    "List pending proposals for one explicitly selected owned environment.",
    { environmentId: string },
    ["environmentId"],
    true,
  ),
  tool(
    "review_proposal",
    "Review a proposal against authenticated shared bytes. Does not apply or publish.",
    {
      environmentId: string,
      proposalId: string,
      cursor: { type: "integer", minimum: 0 },
    },
    ["environmentId", "proposalId"],
    true,
  ),
  tool(
    "commit_proposal",
    "Request separate native human approval to apply and publish this exact proposal.",
    { environmentId: string, proposalId: string, reviewDigest: string },
    ["environmentId", "proposalId", "reviewDigest"],
    false,
  ),
  tool(
    "revoke_share",
    "Request separate native human confirmation to revoke one owned share.",
    { environmentId: string },
    ["environmentId"],
    false,
  ),
];

type OwnerActionReview = {
  action: "apply-proposal" | "revoke";
  environmentId: string;
  relayOrigin: string;
  proposalId?: string;
  reviewDigest?: string;
  operations?: Array<{ type: string; path: string }>;
  baseRevisionId?: string;
};

export function creatorDoctor() {
  return {
    creatorCommand: "agentshare creator-mcp",
    sessionContextCommand: "agentshare session-context",
    nativeApproval: "requires-host-verification",
    support: "Windows/Codex candidate; not yet release-certified",
    next: "Reload MCP servers if supported; otherwise restart the host. Call resolve_creator_session with the exact current thread ID. Publishing requires native form confirmation; terminal review is the fallback.",
  };
}

export function createCreatorRuntime(
  options: DraftOptions & {
    confirm: (review: DraftReview) => Promise<boolean>;
    confirmAction?: (review: OwnerActionReview) => Promise<boolean>;
    capture?: typeof exportCurrentCodexCapture;
    relayOrigin?: string;
    handoffOrigin?: string;
  },
) {
  const sessions = new Map<string, { threadId: string; root: string }>();
  return async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    const definition = CREATOR_TOOLS.find((item) => item.name === name);
    if (definition === undefined) throw new Error("Unknown creator tool");
    for (const key of Object.keys(args))
      if (!(key in definition.inputSchema.properties))
        throw new Error(`Unexpected creator argument: ${key}`);
    for (const key of definition.inputSchema.required)
      if (!(key in args)) throw new Error(`Missing creator argument: ${key}`);
    if (name === "resolve_creator_session") {
      const threadId = textArg(args, "threadId");
      const capture = await (options.capture ?? exportCurrentCodexCapture)({
        threadId,
      });
      const sessionRef = `session_${randomUUID()}`;
      sessions.set(sessionRef, { threadId, root: capture.workspaceRoot });
      const rootStatus = await stat(capture.workspaceRoot)
        .then((s) => (s.isDirectory() ? "available" : "inaccessible"))
        .catch(() => "missing");
      return {
        sessionRef,
        sourceAgent: "codex",
        threadId,
        recordedRoot: capture.workspaceRoot,
        rootStatus,
      };
    }
    if (name === "prepare_share") {
      const sessionRef = textArg(args, "sessionRef");
      const session = sessions.get(sessionRef);
      if (session === undefined)
        throw new Error(
          "SESSION_REQUIRED: resolve the exact current session first",
        );
      const scope = textArg(args, "scope"),
        access = textArg(args, "access");
      if (
        !["conversation", "workspace", "both"].includes(scope) ||
        !["read", "read_propose"].includes(access)
      )
        throw new Error("Invalid share scope/access");
      if (typeof args.ttlSeconds !== "number")
        throw new Error("ttlSeconds must be an integer");
      const captured = await (options.capture ?? exportCurrentCodexCapture)({
        threadId: session.threadId,
      });
      if (captured.workspaceRoot !== session.root)
        throw new Error("Session project changed; resolve again");
      const root =
        args.workspaceRootOverride === undefined
          ? captured.workspaceRoot
          : textArg(args, "workspaceRootOverride");
      if (args.workspaceRootOverride !== undefined && !isAbsolute(root))
        throw new Error("Project override must be an absolute path");
      const selectedRoot =
        scope === "conversation" ? root : await realpath(root);
      const target: DraftTarget =
        args.environmentId === undefined
          ? { kind: "new" }
          : {
              kind: "update",
              environmentId: textArg(args, "environmentId"),
              expectedBaseRevisionId: textArg(args, "expectedBaseRevisionId"),
            };
      const owned =
        target.kind === "update"
          ? await findOwnedEnvironment(target.environmentId, options.statePath)
          : undefined;
      return prepareShareDraft(
        { ...captured, workspaceRoot: selectedRoot },
        {
          ...options,
          sessionRef: session.threadId,
          recordedRoot: captured.workspaceRoot,
          target,
          policy: {
            includeConversation: scope !== "workspace",
            includeWorkspace: scope !== "conversation",
            proposalsEnabled: access === "read_propose",
          },
          ttlSeconds: args.ttlSeconds,
          relayOrigin:
            owned?.relayOrigin ??
            options.relayOrigin ??
            process.env.AGENTSHARE_RELAY ??
            RELAY,
          handoffOrigin:
            options.handoffOrigin ?? process.env.AGENTSHARE_HANDOFF ?? HANDOFF,
        },
      );
    }
    if (name === "review_share") {
      const draft = await readShareDraft(
        textArg(args, "draftId"),
        textArg(args, "digest"),
        options,
      );
      const section = textArg(args, "section");
      const cursor = args.cursor ?? 0;
      if (
        typeof cursor !== "number" ||
        !Number.isSafeInteger(cursor) ||
        cursor < 0
      )
        throw new Error("Invalid review cursor");
      let contents: string;
      if (section === "summary")
        contents = JSON.stringify(
          {
            title: draft.prepared.capture.title,
            summary: draft.prepared.summary,
            policy: draft.policy,
            target: draft.target,
            relayOrigin: draft.relayOrigin,
            handoffOrigin: draft.handoffOrigin,
            recordedRoot: draft.recordedRoot,
            selectedRoot: draft.prepared.capture.workspaceRoot,
            cutoff: draft.createdAt,
            ttlSeconds: draft.ttlSeconds,
            existingExpiresAt: draft.existingExpiresAt,
          },
          null,
          2,
        );
      else if (section === "exclusions")
        contents = JSON.stringify(draft.prepared.excluded, null, 2);
      else if (section === "redactions")
        contents = JSON.stringify(draft.prepared.findings, null, 2);
      else if (section === "conversation" || section === "files")
        contents = reviewPayload({
          version: "acb-v1",
          title: draft.prepared.capture.title,
          sourceAgent: draft.prepared.capture.sourceAgent,
          exportedAt: draft.createdAt,
          events:
            section === "conversation"
              ? draft.prepared.capture.conversation
              : [],
          resources:
            section === "files"
              ? draft.prepared.snapshot.files.map((f, i) => ({
                  id: `file-${i}`,
                  sourcePath: f.path,
                  mediaType: f.mediaType,
                  byteLength: f.byteLength,
                  sha256: f.sha256,
                  contentBase64: f.contentBase64,
                }))
              : [],
        });
      else throw new Error("Invalid review section");
      const safe = sanitizeTerminalText(contents);
      return {
        digest: args.digest,
        content: safe.slice(cursor, cursor + 8000),
        ...(cursor + 8000 < safe.length ? { nextCursor: cursor + 8000 } : {}),
      };
    }
    if (name === "list_proposals") {
      return (
        await listOwnedProposals(textArg(args, "environmentId"), options)
      ).map(({ proposal, status }) => ({
        proposalId: proposal.proposalId,
        baseRevisionId: proposal.baseRevisionId,
        status,
        summary: sanitizeTerminalText(scanText(proposal.summary).text),
        operations: proposal.operations.length,
      }));
    }
    if (name === "review_proposal" || name === "commit_proposal") {
      const environmentId = textArg(args, "environmentId"),
        proposalId = textArg(args, "proposalId");
      const prepared = await prepareOwnedProposalReview(
        environmentId,
        proposalId,
        options,
      );
      if (name === "review_proposal") {
        const current = new Map<string, string>();
        for (const file of prepared.base.snapshot.files) {
          const content = classifyResourceContent(
            file.mediaType,
            Buffer.from(file.contentBase64, "base64"),
          );
          current.set(
            file.path,
            content.kind === "text" ? content.text : "<binary; metadata only>",
          );
        }
        const displayProposal = structuredClone(prepared.proposal);
        for (const operation of displayProposal.operations) {
          if (operation.type === "delete") continue;
          const bytes = Buffer.from(operation.contentBase64, "base64");
          const classified = classifyResourceContent(
            operation.mediaType,
            bytes,
          );
          operation.contentBase64 = Buffer.from(
            classified.kind === "text"
              ? classified.text
              : `<binary: ${bytes.byteLength} bytes; sha256=${operation.newSha256}>`,
          ).toString("base64");
        }
        const content = sanitizeTerminalText(
          scanText(renderProposalDiff(displayProposal, current)).text,
        );
        const cursor = args.cursor ?? 0;
        if (
          typeof cursor !== "number" ||
          !Number.isSafeInteger(cursor) ||
          cursor < 0
        )
          throw new Error("Invalid review cursor");
        return {
          reviewDigest: prepared.digest,
          baseRevisionId: prepared.proposal.baseRevisionId,
          content: content.slice(cursor, cursor + 8000),
          ...(cursor + 8000 < content.length
            ? { nextCursor: cursor + 8000 }
            : {}),
        };
      }
      const reviewDigest = textArg(args, "reviewDigest");
      if (prepared.digest !== reviewDigest)
        throw new Error("Proposal review changed; review again");
      const owned = await findOwnedEnvironment(
        environmentId,
        options.statePath,
      );
      if (owned === undefined) throw new Error("Environment no longer owned");
      if (options.confirmAction === undefined)
        throw new Error("HUMAN_APPROVAL_UNAVAILABLE");
      if (
        !(await options.confirmAction({
          action: "apply-proposal",
          environmentId,
          relayOrigin: owned.relayOrigin,
          proposalId,
          reviewDigest,
          baseRevisionId: prepared.proposal.baseRevisionId,
          operations: prepared.proposal.operations.map(({ type, path }) => ({
            type,
            path,
          })),
        }))
      )
        throw new Error("Proposal approval cancelled");
      const applied = await approveOwnedProposal(
        environmentId,
        proposalId,
        undefined,
        { ...options, reviewDigest },
      );
      return {
        environmentId,
        proposalId,
        revisionId: applied.environment.currentRevisionId,
        summary: applied.summary,
      };
    }
    if (name === "revoke_share") {
      const environmentId = textArg(args, "environmentId");
      const owned = await findOwnedEnvironment(
        environmentId,
        options.statePath,
      );
      if (owned === undefined) throw new Error("Environment no longer owned");
      if (options.confirmAction === undefined)
        throw new Error("HUMAN_APPROVAL_UNAVAILABLE");
      if (
        !(await options.confirmAction({
          action: "revoke",
          environmentId,
          relayOrigin: owned.relayOrigin,
        }))
      )
        throw new Error("Revocation cancelled");
      await revokeOwnedEnvironment(environmentId, options.statePath);
      return { environmentId, status: "revoked" };
    }
    if (name === "commit_share")
      return commitShareDraft(
        textArg(args, "draftId"),
        textArg(args, "digest"),
        options,
      );
    return shareDraftStatus(textArg(args, "draftId"), options);
  };
}

/** Multiplex requests: an in-flight tools/call must not block its elicitation response. */
export async function runCreatorMcpServer(
  options: DraftOptions & {
    input?: Readable;
    output?: Writable;
    approvalTimeoutMs?: number;
  } = {},
): Promise<void> {
  const input = options.input ?? process.stdin,
    output = options.output ?? process.stdout;
  const lines = createInterface({ input, crlfDelay: Infinity });
  let supportsForms = false;
  const approvals = new Map<string, (value: unknown) => void>();
  const active = new Set<Promise<void>>();
  const send = (value: unknown) => {
    output.write(`${JSON.stringify(value)}\n`);
  };
  const confirmOwner = async (
    review: DraftReview | OwnerActionReview,
  ): Promise<boolean> => {
    if (!supportsForms)
      throw new Error(
        "HUMAN_APPROVAL_UNAVAILABLE: this host did not advertise form elicitation; use agentshare review with this draft",
      );
    const id = `owner-consent-${randomUUID()}`;
    const response = await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        approvals.delete(id);
        resolve(undefined);
      }, options.approvalTimeoutMs ?? 120_000);
      approvals.set(id, (value) => {
        clearTimeout(timer);
        approvals.delete(id);
        resolve(value);
      });
      send({
        jsonrpc: "2.0",
        id,
        method: "elicitation/create",
        params: {
          mode: "form",
          message: sanitizeTerminalText(
            `Confirm this exact AgentShare action?\n${JSON.stringify(review, null, 2)}\nPublication grants the selected link audience access. Proposal approval applies and publishes only the reviewed operations. Revocation prevents future access but cannot erase recipients' copies.`,
          ),
          requestedSchema: {
            type: "object",
            properties: {
              confirm: {
                type: "boolean",
                title: "Confirm this exact reviewed action",
                default: false,
              },
            },
            required: ["confirm"],
          },
        },
      });
    });
    return (
      isRecord(response) &&
      response.action === "accept" &&
      isRecord(response.content) &&
      response.content.confirm === true
    );
  };
  const runtime = createCreatorRuntime({
    ...options,
    confirm: confirmOwner,
    confirmAction: confirmOwner,
  });
  const dispatch = async (message: Record<string, unknown>): Promise<void> => {
    if (
      typeof message.id === "string" &&
      approvals.has(message.id) &&
      !Object.hasOwn(message, "method")
    ) {
      approvals.get(message.id)?.(message.result);
      return;
    }
    if (message.id === undefined) return;
    const reply = (result: unknown) =>
      send({ jsonrpc: "2.0", id: message.id, result });
    try {
      if (message.method === "initialize") {
        const params = isRecord(message.params) ? message.params : {};
        const caps = isRecord(params.capabilities) ? params.capabilities : {};
        const elicitation = caps.elicitation;
        supportsForms =
          isRecord(elicitation) &&
          (Object.keys(elicitation).length === 0 || isRecord(elicitation.form));
        reply({
          protocolVersion:
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : "2025-06-18",
          serverInfo: { name: "agentshare-creator", version: "0.3.0" },
          capabilities: { tools: {} },
          instructions:
            "Explicit user sharing only. Resolve the exact current thread, prepare, show review, then commit. Commit requires native human form approval; never impersonate consent. Do not inspect private state or raw transcript storage.",
        });
      } else if (message.method === "tools/list")
        reply({ tools: CREATOR_TOOLS });
      else if (message.method === "ping") reply({});
      else if (message.method === "tools/call") {
        const params = isRecord(message.params) ? message.params : {};
        const result = await runtime(
          textArg(params, "name"),
          isRecord(params.arguments) ? params.arguments : {},
        );
        reply({
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: false,
        });
      } else
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
    } catch (error) {
      reply({
        content: [
          {
            type: "text",
            text: sanitizeTerminalText(
              error instanceof Error ? error.message : "Creator request failed",
            ),
          },
        ],
        isError: true,
      });
    }
  };
  try {
    for await (const line of lines) {
      if (line.length > 1_048_576) {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Request too large" },
        });
        continue;
      }
      try {
        const value: unknown = JSON.parse(line);
        if (!isRecord(value)) throw new Error("Invalid request");
        const task = dispatch(value);
        active.add(task);
        void task.finally(() => active.delete(task));
      } catch {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid JSON-RPC" },
        });
      }
    }
  } finally {
    for (const complete of approvals.values()) complete(undefined);
    await Promise.all(active);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Missing ${key}`);
  return value;
}
