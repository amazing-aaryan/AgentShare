import { resolve } from "node:path";
import { buildEnvironmentUrl, keyFromFragment } from "@agentshare/acb";
import { exportCurrentClaudeCapture } from "@agentshare/adapter-claude";
import { exportCurrentCodexCapture } from "@agentshare/adapter-codex";
import { MAX_TTL_SECONDS } from "@agentshare/contracts";
import { classifyResourceContent } from "@agentshare/scanner";
import {
  commitShareDraft,
  prepareShareDraft,
  readShareDraft,
  type DraftOptions,
  type DraftReview,
  type ShareDraft,
} from "../environment/drafts.js";
import {
  type CreateEnvironmentResult,
  type HostCapture,
} from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import {
  findOwnedEnvironment,
  loadEnvironmentState,
  type OwnedEnvironment,
} from "../environment/state.js";
import { sanitizeTerminalText } from "../terminal.js";
import { chooseOption } from "../tui/input.js";
import {
  defaultShareSelection,
  selectionToShareOptions,
  SHARE_ACCESS_OPTIONS,
  SHARE_EXPIRY_OPTIONS,
  SHARE_SCOPE_OPTIONS,
  type SelectedShareOptions,
} from "../tui/share-flow.js";

const DEFAULT_RELAY =
  "https://agentshare-relay.carnation-vermicelli.workers.dev";
export const DEFAULT_V2_HANDOFF_ORIGIN =
  "https://agentshare-handoff.carnation-vermicelli.workers.dev";

export type ShareV2Options = {
  relayOrigin?: string;
  handoffOrigin?: string;
  forceNew?: boolean;
  ttlSeconds?: number;
  statePath?: string;
  client?: EnvironmentRelayClient;
  selection?: SelectedShareOptions;
  existingEnvironmentId?: string;
  sessionId?: string;
  projectRoot?: string;
  recordedRoot?: string;
  workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
};

export async function shareCurrentV2(
  source: "codex" | "claude",
  options: ShareV2Options = {},
): Promise<CreateEnvironmentResult> {
  // Existing link management never requires loading a transcript or workspace.
  if (
    options.forceNew !== true &&
    options.existingEnvironmentId === undefined
  ) {
    const existing = await chooseExistingEnvironment(
      options.projectRoot ?? process.cwd(),
      options,
    );
    if (existing !== undefined) {
      assertInteractiveCreatorApproval();
      const action = await chooseOption(
        "AgentShare - " +
          existing.environmentId +
          (existing.pendingRevision === undefined
            ? ""
            : " (publication pending)"),
        [
          "Cancel",
          "Update shared environment",
          "Copy existing link",
          "Create separate share",
        ],
        0,
      );
      if (action === 0) throw new Error("AgentShare cancelled");
      if (action === 2) return existingResult(existing, options.handoffOrigin);
      options =
        action === 1
          ? { ...options, existingEnvironmentId: existing.environmentId }
          : { ...options, forceNew: true };
    }
  }
  if (
    source === "claude" &&
    (options.sessionId !== undefined || options.projectRoot !== undefined)
  ) {
    throw new Error(
      "Explicit session/project selection is currently supported for Codex only",
    );
  }
  const capture =
    source === "codex"
      ? await exportCurrentCodexCapture({
          validateProjectRoot: true,
          ...(options.sessionId === undefined
            ? {}
            : { sessionId: options.sessionId }),
          ...(options.projectRoot === undefined
            ? {}
            : { projectRoot: options.projectRoot }),
        })
      : await exportCurrentClaudeCapture();
  return shareCaptureV2(capture, {
    ...options,
    ...("sessionRef" in capture && typeof capture.sessionRef === "string"
      ? { sessionId: capture.sessionRef }
      : {}),
    ...("recordedRoot" in capture && typeof capture.recordedRoot === "string"
      ? { recordedRoot: capture.recordedRoot }
      : {}),
  });
}

export async function shareCaptureV2(
  capture: HostCapture,
  options: ShareV2Options = {},
): Promise<CreateEnvironmentResult> {
  assertInteractiveCreatorApproval();
  validateTtlSeconds(options.ttlSeconds);
  const existing =
    options.forceNew === true
      ? undefined
      : await chooseExistingEnvironment(capture.workspaceRoot, options);
  if (
    existing !== undefined &&
    resolve(existing.workspaceRoot) !== resolve(capture.workspaceRoot) &&
    (options.projectRoot === undefined ||
      resolve(options.projectRoot) !== resolve(capture.workspaceRoot))
  ) {
    throw new Error(
      "Selected environment belongs to another project root; supply explicit --project-root and review relocation",
    );
  }
  if (existing?.pendingRevision !== undefined)
    throw new Error(
      "Environment publication pending; use scoped repair before updating",
    );
  const selection =
    existing === undefined
      ? (options.selection ?? (await interactiveSelection()))
      : {
          ...existing.sharePolicy,
          ttlSeconds: Math.floor(
            (Date.parse(existing.expiresAt) - Date.now()) / 1000,
          ),
        };
  if (existing !== undefined && options.ttlSeconds !== undefined)
    throw new Error(
      "Updating an environment preserves its saved expiry; use --new to change it",
    );
  const ttlSeconds = options.ttlSeconds ?? selection.ttlSeconds;
  validateTtlSeconds(ttlSeconds);
  const relayOrigin =
    existing?.relayOrigin ??
    options.client?.origin ??
    options.relayOrigin ??
    process.env.AGENTSHARE_RELAY ??
    DEFAULT_RELAY;
  if (
    existing !== undefined &&
    options.relayOrigin !== undefined &&
    options.relayOrigin !== existing.relayOrigin
  ) {
    throw new Error(
      "Existing environment uses its saved relay; relay override does not match",
    );
  }
  if (options.client !== undefined && options.client.origin !== relayOrigin)
    throw new Error("Client does not match the saved relay");
  const sessionRef = options.sessionId ?? capture.conversation[0]?.sourceId;
  if (sessionRef === undefined || sessionRef.length === 0)
    throw new Error(
      "Exact session identity is required to prepare a share draft",
    );
  const baseRevisionId = existing?.currentRevisionId;
  if (
    existing !== undefined &&
    (baseRevisionId === null || baseRevisionId === undefined)
  )
    throw new Error(
      "Environment has no published revision; scoped repair required",
    );
  const review = await prepareShareDraft(capture, {
    sessionRef,
    recordedRoot: options.recordedRoot ?? capture.workspaceRoot,
    target:
      existing === undefined ||
      baseRevisionId === undefined ||
      baseRevisionId === null
        ? { kind: "new" }
        : {
            kind: "update",
            environmentId: existing.environmentId,
            expectedBaseRevisionId: baseRevisionId,
          },
    policy: {
      includeConversation: selection.includeConversation,
      includeWorkspace: selection.includeWorkspace,
      proposalsEnabled: selection.proposalsEnabled,
    },
    ttlSeconds,
    relayOrigin,
    handoffOrigin: options.handoffOrigin ?? DEFAULT_V2_HANDOFF_ORIGIN,
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
    ...(options.workspaceOptions === undefined
      ? {}
      : { workspaceOptions: options.workspaceOptions }),
  });
  return reviewShareDraftInTerminal(review.draftId, review.digest, {
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
    ...(options.client === undefined ? {} : { client: options.client }),
  });
}

/** The only terminal publication path: review and commit the SAME persisted bytes. */
export async function reviewShareDraftInTerminal(
  draftId: string,
  digest: string,
  options: DraftOptions = {},
): Promise<CreateEnvironmentResult> {
  assertInteractiveCreatorApproval();
  const draft = await readShareDraft(draftId, digest, options);
  const result = await commitShareDraft(draftId, digest, {
    ...options,
    confirm: async (review) => {
      assertInteractiveCreatorApproval();
      return reviewRetainedDraft(draft, review);
    },
  });
  const environment = await findOwnedEnvironment(
    result.environmentId,
    options.statePath,
  );
  if (environment === undefined)
    throw new Error("Published environment receipt missing locally");
  return { environment, url: result.url, summary: result.summary };
}

async function reviewRetainedDraft(
  draft: ShareDraft,
  review: DraftReview,
): Promise<boolean> {
  while (true) {
    const action = await chooseOption(
      [
        "AgentShare - Exact retained draft",
        "Draft: " + review.draftId,
        "Digest: " + review.digest,
        "Session: " + review.sessionRef,
        "Recorded project: " + review.recordedRoot,
        "Selected project: " + review.selectedRoot,
        "Relay: " + review.relayOrigin,
        "Target: " +
          (review.target.kind === "new"
            ? "New environment"
            : review.target.environmentId),
        "Base revision: " +
          (review.target.kind === "new"
            ? "<none>"
            : review.target.expectedBaseRevisionId),
        "Capture cutoff: " + draft.createdAt,
        "Scope: " +
          (review.policy.includeConversation && review.policy.includeWorkspace
            ? "conversation + workspace"
            : review.policy.includeConversation
              ? "conversation"
              : "workspace"),
        `Conversation events: ${review.summary.conversationEvents}`,
        `Files: ${review.summary.files}`,
        `Workspace bytes: ${review.summary.totalWorkspaceBytes}`,
        `Excluded files: ${review.summary.excludedFiles}`,
        `Secret redactions: ${review.summary.redactions}`,
        "Access: " +
          (review.policy.proposalsEnabled
            ? "Read + propose changes"
            : "Read only"),
        review.existingExpiresAt === undefined
          ? `Expires in: ${review.ttlSeconds} seconds after creation`
          : `Saved expiry (unchanged): ${review.existingExpiresAt}`,
        "Approval expires: " + review.approvalExpiresAt,
      ].join("\n"),
      [
        "Cancel",
        "Review retained file contents",
        "Review retained conversation",
        "Review exclusions and redactions",
        "Publish exact reviewed draft",
      ],
      0,
    );
    if (action === 0) return false;
    if (action === 4) return true;
    if (action === 1) {
      await showPages(
        "Retained file contents",
        draft.prepared.snapshot.files
          .map((file) => {
            const content = classifyResourceContent(
              file.mediaType,
              Buffer.from(file.contentBase64, "base64"),
            );
            return (
              "FILE " +
              file.path +
              "\nSHA-256 " +
              file.sha256 +
              "\nMedia type: " +
              content.mediaType +
              "\nBytes: " +
              String(file.byteLength) +
              "\n" +
              (content.kind === "text"
                ? content.text
                : "<binary: metadata only; bytes are not decoded>")
            );
          })
          .join("\n\n"),
      );
    } else if (action === 2) {
      await showPages(
        "Retained conversation",
        draft.prepared.capture.conversation
          .map((event) => event.role + ": " + event.text)
          .join("\n\n"),
      );
    } else if (action === 3) {
      await showPages(
        "Exclusions and redactions",
        [
          ...draft.prepared.excluded.map(
            (item) => item.path + " - " + item.reason,
          ),
          ...draft.prepared.findings.map(
            (item) =>
              item.kind + " - " + item.location + " - " + item.redactedPreview,
          ),
        ].join("\n"),
      );
    } else throw new Error("Invalid review selection");
  }
}

async function showPages(title: string, text: string): Promise<void> {
  // Wrap before pagination so a single long retained line remains reviewable.
  const width = Math.max(
    20,
    Math.min(100, (process.stdout.columns || 100) - 4),
  );
  const height = Math.max(4, Math.min(20, (process.stdout.rows || 30) - 10));
  const lines = sanitizeTerminalText(text || "<none>")
    .split("\n")
    .flatMap((line) => {
      const chars = Array.from(line);
      return chars.length === 0
        ? [""]
        : Array.from({ length: Math.ceil(chars.length / width) }, (_, index) =>
            chars.slice(index * width, (index + 1) * width).join(""),
          );
    });
  const count = Math.ceil(lines.length / height);
  let page = 0;
  while (true) {
    const action = await chooseOption(
      `${title} (${page + 1}/${count})\n\n${lines.slice(page * height, (page + 1) * height).join("\n")}`,
      ["Back to draft", "Next page", "Previous page"],
      0,
    );
    if (action === 0) return;
    page = action === 1 ? Math.min(count - 1, page + 1) : Math.max(0, page - 1);
  }
}

async function chooseExistingEnvironment(
  workspaceRoot: string,
  options: ShareV2Options,
): Promise<OwnedEnvironment | undefined> {
  if (options.existingEnvironmentId !== undefined) {
    const owned = await findOwnedEnvironment(
      options.existingEnvironmentId,
      options.statePath,
    );
    if (owned === undefined)
      throw new Error("Selected environment is not owned locally");
    return owned;
  }
  const state = await loadEnvironmentState(options.statePath);
  const matches = state.ownedEnvironments.filter(
    (item) =>
      resolve(item.workspaceRoot) === resolve(workspaceRoot) &&
      Date.parse(item.expiresAt) > Date.now(),
  );
  if (matches.length <= 1) return matches[0];
  assertInteractiveCreatorApproval();
  const selected = await chooseOption(
    "AgentShare - Choose exact existing environment",
    [
      "Cancel",
      ...matches.map(
        (item) =>
          item.environmentId +
          " | " +
          item.relayOrigin +
          " | " +
          (item.pendingRevision === undefined ? "published" : "pending") +
          " | " +
          item.expiresAt,
      ),
    ],
    0,
  );
  const match = matches[selected - 1];
  if (match === undefined) throw new Error("AgentShare cancelled");
  return match;
}

async function interactiveSelection(): Promise<SelectedShareOptions> {
  assertInteractiveCreatorApproval();
  const defaults = defaultShareSelection();
  const scope = await chooseOption(
    "AgentShare - What do you want to share?",
    SHARE_SCOPE_OPTIONS,
    defaults.scope,
  );
  const access = await chooseOption(
    "AgentShare - Access",
    SHARE_ACCESS_OPTIONS,
    defaults.access,
  );
  const expiry = await chooseOption(
    "AgentShare - Expires",
    SHARE_EXPIRY_OPTIONS,
    defaults.expiry,
  );
  return selectionToShareOptions({ scope, access, expiry });
}

function assertInteractiveCreatorApproval(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Interactive creator approval requires a TTY; run AgentShare in an interactive terminal.",
    );
}

function validateTtlSeconds(value: number | undefined): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 1 || value > MAX_TTL_SECONDS)
  ) {
    throw new Error(
      `ttlSeconds must be an integer between 1 and ${MAX_TTL_SECONDS} seconds`,
    );
  }
}

export async function copyOwnedEnvironmentLink(
  environmentId: string,
  statePath?: string,
): Promise<string> {
  const owned = await findOwnedEnvironment(environmentId, statePath);
  if (owned === undefined)
    throw new Error("Selected environment is not owned locally");
  return existingResult(owned).url;
}

function existingResult(
  environment: OwnedEnvironment,
  handoffOrigin?: string,
): CreateEnvironmentResult {
  if (
    environment.pendingRevision !== undefined ||
    environment.currentRevisionId === null
  )
    throw new Error(
      "Environment publication pending; scoped repair required before copying link",
    );
  if (Date.parse(environment.expiresAt) <= Date.now())
    throw new Error("Environment expired; create and review a new share");
  return {
    environment,
    url: ownedEnvironmentUrl(environment, handoffOrigin),
    summary: {
      files: 0,
      conversationEvents: 0,
      totalWorkspaceBytes: 0,
      excludedFiles: 0,
      redactions: 0,
      proposalsEnabled: environment.sharePolicy.proposalsEnabled,
    },
  };
}

export function ownedEnvironmentUrl(
  environment: OwnedEnvironment,
  handoffOrigin = DEFAULT_V2_HANDOFF_ORIGIN,
): string {
  return buildEnvironmentUrl({
    handoffOrigin,
    relayOrigin: environment.relayOrigin,
    environmentId: environment.environmentId,
    readCapability: environment.readCapability,
    environmentMasterKey: keyFromFragment(environment.environmentMasterKey),
    ...(environment.proposalCapability === undefined
      ? {}
      : { proposalCapability: environment.proposalCapability }),
  });
}
