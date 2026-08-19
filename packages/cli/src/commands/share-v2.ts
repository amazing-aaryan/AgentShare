import { buildEnvironmentUrl, keyFromFragment } from "@agentshare/acb";
import { exportCurrentClaudeCapture } from "@agentshare/adapter-claude";
import { exportCurrentCodexCapture } from "@agentshare/adapter-codex";
import {
  createEnvironmentFromCapture,
  publishEnvironmentRevision,
  type CreateEnvironmentResult,
  type HostCapture,
} from "../environment/publication.js";
import { previewEnvironmentCapture } from "../environment/preview.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import {
  findOwnedEnvironment,
  findOwnedEnvironmentForWorkspace,
  type OwnedEnvironment,
} from "../environment/state.js";
import { chooseOption } from "../tui/input.js";
import {
  defaultShareSelection,
  selectionToShareOptions,
  SHARE_ACCESS_OPTIONS,
  SHARE_EXPIRY_OPTIONS,
  SHARE_SCOPE_OPTIONS,
  type SelectedShareOptions,
} from "../tui/share-flow.js";
import { reviewProposalInbox } from "./inbox-v2.js";

const DEFAULT_RELAY =
  "https://agentshare-relay.carnation-vermicelli.workers.dev";

export type ShareV2Options = {
  relayOrigin?: string;
  statePath?: string;
  client?: EnvironmentRelayClient;
  selection?: SelectedShareOptions;
  existingEnvironmentId?: string;
  workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
};

export async function shareCurrentV2(
  source: "codex" | "claude",
  options: ShareV2Options = {},
): Promise<CreateEnvironmentResult> {
  const capture =
    source === "codex"
      ? await exportCurrentCodexCapture()
      : await exportCurrentClaudeCapture();
  return shareCaptureV2(capture, options);
}

export async function shareCaptureV2(
  capture: HostCapture,
  options: ShareV2Options = {},
): Promise<CreateEnvironmentResult> {
  const client =
    options.client ??
    new EnvironmentRelayClient(
      options.relayOrigin ?? process.env.AGENTSHARE_RELAY ?? DEFAULT_RELAY,
    );
  const existing =
    options.existingEnvironmentId === undefined
      ? await findOwnedEnvironmentForWorkspace(
          capture.workspaceRoot,
          options.statePath,
        )
      : await findOwnedEnvironment(
          options.existingEnvironmentId,
          options.statePath,
        );

  if (existing !== undefined && options.selection === undefined) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return updateEnvironment(capture, existing, client, options);
    }
    const action = await chooseOption(
      `AgentShare - ${existing.environmentId}`,
      [
        "Update shared environment",
        "Review proposed changes",
        "Copy existing link",
        "Create separate share",
      ],
      0,
    );
    if (action === 0)
      return updateEnvironment(capture, existing, client, options);
    if (action === 1) {
      await reviewProposalInbox(capture.sourceAgent, options.statePath);
      const refreshed =
        (await findOwnedEnvironment(
          existing.environmentId,
          options.statePath,
        )) ?? existing;
      return existingResult(refreshed);
    }
    if (action === 2) return existingResult(existing);
  } else if (
    existing !== undefined &&
    options.existingEnvironmentId !== undefined
  ) {
    return updateEnvironment(capture, existing, client, options);
  }

  const selection = options.selection ?? (await interactiveSelection());
  await reviewBeforePublication(capture, selection, options.workspaceOptions);
  return createEnvironmentFromCapture(capture, {
    client,
    ttlSeconds: selection.ttlSeconds,
    proposalsEnabled: selection.proposalsEnabled,
    includeConversation: selection.includeConversation,
    includeWorkspace: selection.includeWorkspace,
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
    ...(options.workspaceOptions === undefined
      ? {}
      : { workspaceOptions: options.workspaceOptions }),
  });
}

async function interactiveSelection(): Promise<SelectedShareOptions> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return selectionToShareOptions(defaultShareSelection());
  }
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

async function reviewBeforePublication(
  capture: HostCapture,
  selection: SelectedShareOptions,
  workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number },
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const preview = await previewEnvironmentCapture(capture, {
    includeConversation: selection.includeConversation,
    includeWorkspace: selection.includeWorkspace,
    proposalsEnabled: selection.proposalsEnabled,
    ...(workspaceOptions === undefined ? {} : { workspaceOptions }),
  });
  while (true) {
    const summary = [
      "AgentShare - Share summary",
      "",
      `Project: ${capture.title}`,
      `Conversation events: ${preview.summary.conversationEvents}`,
      `Files: ${preview.summary.files}`,
      `Workspace bytes: ${preview.summary.totalWorkspaceBytes}`,
      `Excluded files: ${preview.summary.excludedFiles}`,
      `Secret redactions: ${preview.summary.redactions}`,
      `Access: ${selection.proposalsEnabled ? "Read + propose changes" : "Read only"}`,
      `Expires in: ${selection.ttlSeconds / 3600} hour${selection.ttlSeconds === 3600 ? "" : "s"}`,
    ].join("\n");
    const action = await chooseOption(
      summary,
      [
        "Create share",
        "Review included files",
        "Review exclusions and redactions",
        "Cancel",
      ],
      0,
    );
    if (action === 0) return;
    if (action === 1) {
      await chooseOption(
        `Included files (${preview.includedPaths.length})\n\n${preview.includedPaths.join("\n") || "<none>"}`,
        ["Back"],
        0,
      );
      continue;
    }
    if (action === 2) {
      const excluded = preview.excluded.map(
        (item) => `${item.path} - ${item.reason}`,
      );
      const findings = preview.findings.map(
        (item) => `${item.kind} - ${item.location} - ${item.redactedPreview}`,
      );
      await chooseOption(
        [
          `Excluded (${excluded.length})`,
          ...excluded,
          "",
          `Redactions (${findings.length})`,
          ...findings,
        ].join("\n"),
        ["Back"],
        0,
      );
      continue;
    }
    throw new Error("AgentShare cancelled");
  }
}

async function updateEnvironment(
  capture: HostCapture,
  environment: OwnedEnvironment,
  client: EnvironmentRelayClient,
  options: ShareV2Options,
): Promise<CreateEnvironmentResult> {
  await reviewBeforePublication(
    capture,
    {
      includeConversation: environment.sharePolicy.includeConversation,
      includeWorkspace: environment.sharePolicy.includeWorkspace,
      proposalsEnabled: environment.sharePolicy.proposalsEnabled,
      ttlSeconds: Math.max(
        0,
        Math.round((Date.parse(environment.expiresAt) - Date.now()) / 1000),
      ),
    },
    options.workspaceOptions,
  );
  const published = await publishEnvironmentRevision(
    capture,
    environment,
    client,
    {
      ...(options.statePath === undefined
        ? {}
        : { statePath: options.statePath }),
      ...(options.workspaceOptions === undefined
        ? {}
        : { workspaceOptions: options.workspaceOptions }),
    },
  );
  return {
    environment: published.environment,
    url: ownedEnvironmentUrl(published.environment),
    summary: published.summary,
  };
}

function existingResult(
  environment: OwnedEnvironment,
): CreateEnvironmentResult {
  return {
    environment,
    url: ownedEnvironmentUrl(environment),
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

export function ownedEnvironmentUrl(environment: OwnedEnvironment): string {
  return buildEnvironmentUrl({
    origin: environment.relayOrigin,
    environmentId: environment.environmentId,
    readCapability: environment.readCapability,
    environmentMasterKey: keyFromFragment(environment.environmentMasterKey),
    ...(environment.proposalCapability === undefined
      ? {}
      : { proposalCapability: environment.proposalCapability }),
  });
}
