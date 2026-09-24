import { AGENTSHARE_VERSION } from "./version.js";
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
import { hostSkillsCurrent, installHostSkills } from "@agentshare/integrations";
import { installPinnedGlobalCli, pinnedGlobalCliInstalled } from "./update.js";

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
    "setup_agentshare",
    "First use after connecting this MCP: ask the user through a native form whether to install the pinned global CLI and local Codex/Claude integration files. Call before other AgentShare tools. Cancel writes nothing.",
    {},
    [],
    false,
  ),
  tool(
    "resolve_creator_session",
    "Resolve an explicit current Codex thread ID. Never guess the latest session.",
    { threadId: string },
    ["threadId"],
    true,
  ),
  tool(
    "select_share_options",
    "Open native choices for files to share, recipient access, and duration. Call after resolving the current session; do not ask for these values in chat.",
    { sessionRef: string },
    ["sessionRef"],
    false,
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
    next: "If the Codex header says YOLO/full-auto, open /permissions and choose On Request in this same session. Codex 0.155.1 has no /approvals command. Reload MCP servers if supported; otherwise restart the host. Call resolve_creator_session with the exact current thread ID. Publishing requires native form confirmation in this session.",
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
    if (name === "select_share_options")
      throw new Error(
        "NATIVE_OPTIONS_REQUIRED: select_share_options requires a connected native MCP host",
      );
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
    capture?: typeof exportCurrentCodexCapture;
    relayOrigin?: string;
    handoffOrigin?: string;
    installSkills?: typeof installHostSkills;
    skillsCurrent?: typeof hostSkillsCurrent;
    installCli?: () => void;
    cliCurrent?: () => boolean;
  } = {},
): Promise<void> {
  const input = options.input ?? process.stdin,
    output = options.output ?? process.stdout;
  const lines = createInterface({ input, crlfDelay: Infinity });
  let supportsForms = false;
  const approvals = new Map<string, (value: unknown) => void>();
  const selectedShareOptions = new Map<
    string,
    {
      scope: "conversation" | "workspace" | "both";
      access: "read" | "read_propose";
      ttlSeconds: number;
    }
  >();
  const active = new Set<Promise<void>>();
  const send = (value: unknown) => {
    output.write(`${JSON.stringify(value)}\n`);
  };
  const setupAgentShare = async (): Promise<unknown> => {
    const cliCurrent = (options.cliCurrent ?? pinnedGlobalCliInstalled)();
    const skillsCurrent = await (options.skillsCurrent ?? hostSkillsCurrent)();
    if (cliCurrent && skillsCurrent)
      return {
        status: "ready",
        installedFiles: 0,
        next: "Use AgentShare in this session.",
      };
    if (!supportsForms)
      throw new Error(
        "SETUP_FORM_UNAVAILABLE: this MCP host did not advertise native form support",
      );
    const id = `setup-consent-${randomUUID()}`;
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
          message:
            "AgentShare is connected. Install the pinned AgentShare CLI globally and six managed Codex/Claude integration files? The CLI is needed for session capture and opening links. This downloads the same version already used by this MCP server and writes skill files in your home directory. Use arrow keys and Enter.",
          requestedSchema: {
            type: "object",
            properties: {
              setup: {
                type: "string",
                title: "Set up AgentShare",
                oneOf: [
                  { const: "install", title: "Install required files" },
                  { const: "cancel", title: "Cancel" },
                ],
              },
            },
            required: ["setup"],
          },
        },
      });
    });
    if (response === undefined)
      throw new Error("SETUP_TIMEOUT: no files installed");
    if (isRecord(response) && isRecord(response.error))
      throw new Error("SETUP_FORM_UNAVAILABLE: host rejected the native form");
    const result = isRecord(response) ? response.result : undefined;
    const selected =
      isRecord(result) && isRecord(result.content)
        ? result.content.setup
        : undefined;
    if (
      isRecord(result) &&
      (["decline", "cancel"].includes(String(result.action)) ||
        (result.action === "accept" && selected === "cancel"))
    )
      return { status: "cancelled", installedFiles: 0 };
    if (
      !isRecord(result) ||
      result.action !== "accept" ||
      selected !== "install"
    )
      throw new Error(
        "SETUP_INCOMPLETE: choose Install or Cancel; no files installed",
      );
    if (!cliCurrent) (options.installCli ?? installPinnedGlobalCli)();
    const files = skillsCurrent
      ? []
      : await (options.installSkills ?? installHostSkills)();
    return {
      status: "ready",
      installedFiles: files.length,
      next: "AgentShare works in this session. New sessions also discover the installed skills.",
    };
  };
  const confirmOwner = async (
    review: DraftReview | OwnerActionReview,
  ): Promise<boolean> => {
    if (!supportsForms)
      throw new Error(
        "HUMAN_APPROVAL_UNAVAILABLE: this host did not advertise form elicitation; use agentshare review with this draft",
      );
    const id = `owner-consent-${randomUUID()}`;
    const approvalLabel =
      "action" in review
        ? review.action === "apply-proposal"
          ? "Apply exact reviewed proposal"
          : "Revoke exact selected share"
        : "Publish exact reviewed draft";
    const confirmation = "approve";
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
            `Review this exact AgentShare action, then use arrow keys to choose an option and press Enter. Approving the MCP tool call alone is not consent.\n${JSON.stringify(review, null, 2)}\nPublication grants the selected link audience access. Proposal approval applies and publishes only the reviewed operations. Revocation prevents future access but cannot erase recipients' copies.`,
          ),
          requestedSchema: {
            type: "object",
            properties: {
              confirmation: {
                type: "string",
                title: "Choose an action",
                oneOf: [
                  { const: confirmation, title: approvalLabel },
                  { const: "cancel", title: "Cancel" },
                ],
              },
            },
            required: ["confirmation"],
          },
        },
      });
    });
    if (response === undefined)
      throw new Error(
        "HUMAN_APPROVAL_TIMEOUT: native confirmation did not return; no action attempted. Reload the Codex MCP server and retry the same reviewed action.",
      );
    if (isRecord(response) && isRecord(response.error))
      throw new Error(
        "HUMAN_APPROVAL_UNAVAILABLE: host rejected native confirmation; no action attempted. Use a Codex session with native form elicitation enabled.",
      );
    const result = isRecord(response) ? response.result : undefined;
    if (
      isRecord(result) &&
      ["decline", "cancel"].includes(String(result.action))
    )
      throw new Error(
        "HUMAN_APPROVAL_DECLINED: native confirmation was declined or auto-cancelled; no action attempted. If Codex is in YOLO/full-auto mode, open /permissions, choose On Request, then retry the same reviewed action.",
      );
    const selected =
      isRecord(result) && isRecord(result.content)
        ? result.content.confirmation
        : undefined;
    if (selected === "cancel")
      throw new Error(
        "HUMAN_APPROVAL_DECLINED: native Cancel option selected; no action attempted. Retry the same draft only after reviewing it again.",
      );
    if (
      !isRecord(result) ||
      result.action !== "accept" ||
      selected !== confirmation
    )
      throw new Error(
        "HUMAN_APPROVAL_INCOMPLETE: native action choice was not Publish/Apply/Revoke; no action attempted. Retry the same reviewed action with the native form.",
      );
    return true;
  };
  const selectShareOptions = async (sessionRef: string) => {
    if (!supportsForms)
      throw new Error(
        "NATIVE_OPTIONS_UNAVAILABLE: this host did not advertise form elicitation; native share choices require the Codex session",
      );
    const id = `share-options-${randomUUID()}`;
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
          message:
            "Choose files to share, recipient access, and duration. Use arrow keys to choose each option and press Enter to advance and submit. No text input is required.",
          requestedSchema: {
            type: "object",
            properties: {
              files: {
                type: "string",
                title: "Files to share",
                oneOf: [
                  { const: "conversation", title: "Conversation only" },
                  { const: "workspace", title: "Project files only" },
                  { const: "both", title: "Conversation + project files" },
                ],
              },
              access: {
                type: "string",
                title: "Recipient access",
                oneOf: [
                  { const: "read", title: "Read only" },
                  {
                    const: "read_propose",
                    title: "Read + propose changes",
                  },
                ],
              },
              duration: {
                type: "string",
                title: "Duration",
                oneOf: [
                  { const: "3600", title: "1 hour" },
                  { const: "86400", title: "24 hours" },
                  { const: "259200", title: "72 hours" },
                ],
              },
            },
            required: ["files", "access", "duration"],
          },
        },
      });
    });
    if (response === undefined)
      throw new Error(
        "NATIVE_OPTIONS_TIMEOUT: share choices did not return; no draft prepared",
      );
    if (isRecord(response) && isRecord(response.error))
      throw new Error(
        "NATIVE_OPTIONS_UNAVAILABLE: host rejected native share choices; no draft prepared",
      );
    const result = isRecord(response) ? response.result : undefined;
    if (
      isRecord(result) &&
      ["decline", "cancel"].includes(String(result.action))
    )
      throw new Error(
        "NATIVE_OPTIONS_DECLINED: share choices cancelled; no draft prepared",
      );
    const content =
      isRecord(result) && isRecord(result.content) ? result.content : undefined;
    const files = content?.files;
    const access = content?.access;
    const duration = content?.duration;
    if (
      !isRecord(result) ||
      result.action !== "accept" ||
      (files !== "conversation" && files !== "workspace" && files !== "both") ||
      (access !== "read" && access !== "read_propose") ||
      (duration !== "3600" && duration !== "86400" && duration !== "259200")
    )
      throw new Error(
        "NATIVE_OPTIONS_INCOMPLETE: choose files, access, and duration with the native form; no draft prepared",
      );
    const selection = {
      scope: files,
      access,
      ttlSeconds: Number(duration),
    } as const;
    selectedShareOptions.set(sessionRef, selection);
    return {
      sessionRef,
      files,
      scope: files,
      access,
      duration,
      ttlSeconds: Number(duration),
    };
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
      approvals.get(message.id)?.(message);
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
          serverInfo: {
            name: "agentshare-creator",
            version: AGENTSHARE_VERSION,
          },
          capabilities: { tools: {} },
          instructions:
            "On first use, call setup_agentshare to offer the native Install/Cancel choice for the pinned global CLI and local integration files. If accepted, continue in this session; no restart needed for MCP tools. Sharing requires an explicit user request: resolve the exact current thread, open native file/access/duration choices, prepare, show a concise summary, then commit. Final Publish/Cancel uses a native form; never impersonate consent. Do not inspect private state or raw transcript storage.",
        });
      } else if (message.method === "tools/list")
        reply({ tools: CREATOR_TOOLS });
      else if (message.method === "ping") reply({});
      else if (message.method === "tools/call") {
        const params = isRecord(message.params) ? message.params : {};
        const name = textArg(params, "name");
        const args = isRecord(params.arguments) ? params.arguments : {};
        let result: unknown;
        if (name === "setup_agentshare") {
          result = await setupAgentShare();
        } else if (name === "select_share_options") {
          result = await selectShareOptions(textArg(args, "sessionRef"));
        } else {
          let runtimeArgs = args;
          if (name === "prepare_share") {
            const sessionRef = textArg(args, "sessionRef");
            const selected = selectedShareOptions.get(sessionRef);
            if (selected === undefined)
              throw new Error(
                "SHARE_OPTIONS_REQUIRED: call select_share_options and use its native choices before preparing",
              );
            runtimeArgs = { ...args, ...selected };
          }
          result = await runtime(name, runtimeArgs);
        }
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
