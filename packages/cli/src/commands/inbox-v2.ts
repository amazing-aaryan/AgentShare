import { classifyResourceContent, scanText } from "@agentshare/scanner";
import {
  approveOwnedProposal,
  prepareOwnedProposalReview,
  rejectOwnedProposal,
} from "../proposals/apply.js";
import { listOwnedProposals, type OwnedProposal } from "../proposals/inbox.js";
import {
  loadEnvironmentState,
  type OwnedEnvironment,
} from "../environment/state.js";
import { chooseOption } from "../tui/input.js";
import { renderProposalDiff } from "../tui/proposal-review.js";
import { sanitizeTerminalText } from "../terminal.js";

export type PendingProposalItem = {
  environment: OwnedEnvironment;
  item: OwnedProposal;
};

export async function listPendingOwnedProposals(
  statePath?: string,
  environmentId?: string,
): Promise<PendingProposalItem[]> {
  const state = await loadEnvironmentState(statePath);
  const pending: PendingProposalItem[] = [];
  for (const environment of state.ownedEnvironments) {
    if (
      environmentId !== undefined &&
      environment.environmentId !== environmentId
    )
      continue;
    if (Date.parse(environment.expiresAt) <= Date.now()) continue;
    for (const item of await listOwnedProposals(environment.environmentId, {
      ...(statePath === undefined ? {} : { statePath }),
    })) {
      if (item.status === "pending") pending.push({ environment, item });
    }
  }
  return pending.sort((left, right) =>
    left.item.proposal.createdAt.localeCompare(right.item.proposal.createdAt),
  );
}

export async function reviewProposalInbox(
  _source: "codex" | "claude",
  statePath?: string,
  environmentId?: string,
): Promise<void> {
  const pending = await listPendingOwnedProposals(statePath, environmentId);
  if (pending.length === 0) {
    process.stdout.write("No pending AgentShare proposals.\n");
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(
      `${JSON.stringify(
        pending.map(({ environment, item }) => ({
          environmentId: environment.environmentId,
          proposalId: item.proposal.proposalId,
          summary: safeDisplay(item.proposal.summary),
          baseRevisionId: item.proposal.baseRevisionId,
          operations: item.proposal.operations.map((operation) => ({
            type: operation.type,
            path: safeDisplay(operation.path),
          })),
        })),
        null,
        2,
      )}\n`,
    );
    return;
  }

  const selected = await chooseOption(
    `AgentShare - ${pending.length} proposal${pending.length === 1 ? "" : "s"} waiting`,
    pending.map(
      ({ item }) =>
        `${safeDisplay(item.proposal.summary)} - ${item.proposal.operations.length} file operation${item.proposal.operations.length === 1 ? "" : "s"}`,
    ),
    0,
  );
  const chosen = pending[selected];
  if (chosen === undefined) throw new Error("Invalid proposal selection");
  const review = await prepareOwnedProposalReview(
    chosen.environment.environmentId,
    chosen.item.proposal.proposalId,
    statePath === undefined ? {} : { statePath },
  );
  const current = new Map<string, string>();
  for (const file of review.base.snapshot.files) {
    current.set(
      file.path,
      displayContent(file.mediaType, file.contentBase64, file.sha256),
    );
  }
  // Presentation-only copy: renderProposalDiff must never permissively decode binary.
  const displayProposal = structuredClone(review.proposal);
  for (const operation of displayProposal.operations) {
    if (operation.type === "delete") continue;
    operation.contentBase64 = Buffer.from(
      displayContent(
        operation.mediaType,
        operation.contentBase64,
        operation.newSha256,
      ),
    ).toString("base64");
  }
  const diff = safeDisplay(renderProposalDiff(displayProposal, current));
  // The selection widget clears on every keypress; keep the full diff in its title.
  const action = await chooseOption(
    `${diff}\nOutbound revision: approved shared base + these operations only.\nReview digest: ${review.digest}\n\nAgentShare - Proposal decision`,
    ["Approve & apply", "Reject", "Cancel"],
    2,
  );
  if (action === 2) return;
  if (action === 1) {
    await rejectOwnedProposal(
      chosen.environment.environmentId,
      chosen.item.proposal.proposalId,
      statePath === undefined ? {} : { statePath },
    );
    process.stdout.write("Proposal rejected.\n");
    return;
  }
  const approved = await approveOwnedProposal(
    chosen.environment.environmentId,
    chosen.item.proposal.proposalId,
    undefined,
    {
      ...(statePath === undefined ? {} : { statePath }),
      reviewDigest: review.digest,
    },
  );
  process.stdout.write(
    `Proposal approved and published as revision ${approved.environment.currentRevisionId}.\n`,
  );
}

function safeDisplay(text: string): string {
  return sanitizeTerminalText(scanText(text).text);
}

function displayContent(
  mediaType: string,
  contentBase64: string,
  sha256: string,
): string {
  const bytes = Buffer.from(contentBase64, "base64");
  const content = classifyResourceContent(mediaType, bytes);
  return content.kind === "text"
    ? content.text
    : `<binary: ${bytes.byteLength} bytes; sha256=${sha256}>`;
}
