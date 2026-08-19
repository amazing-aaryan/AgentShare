import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportCurrentClaudeCapture } from "@agentshare/adapter-claude";
import { exportCurrentCodexCapture } from "@agentshare/adapter-codex";
import {
  approveOwnedProposal,
  rejectOwnedProposal,
} from "../proposals/apply.js";
import { listOwnedProposals, type OwnedProposal } from "../proposals/inbox.js";
import {
  loadEnvironmentState,
  type OwnedEnvironment,
} from "../environment/state.js";
import { chooseOption } from "../tui/input.js";
import { renderProposalDiff } from "../tui/proposal-review.js";

export type PendingProposalItem = {
  environment: OwnedEnvironment;
  item: OwnedProposal;
};

export async function listPendingOwnedProposals(
  statePath?: string,
): Promise<PendingProposalItem[]> {
  const state = await loadEnvironmentState(statePath);
  const pending: PendingProposalItem[] = [];
  for (const environment of state.ownedEnvironments) {
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
  source: "codex" | "claude",
  statePath?: string,
): Promise<void> {
  const pending = await listPendingOwnedProposals(statePath);
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
          summary: item.proposal.summary,
          baseRevisionId: item.proposal.baseRevisionId,
          operations: item.proposal.operations.map((operation) => ({
            type: operation.type,
            path: operation.path,
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
        `${item.proposal.summary} - ${item.proposal.operations.length} file operation${item.proposal.operations.length === 1 ? "" : "s"}`,
    ),
    0,
  );
  const chosen = pending[selected];
  if (chosen === undefined) throw new Error("Invalid proposal selection");
  const current = new Map<string, string>();
  for (const operation of chosen.item.proposal.operations) {
    if (operation.type === "create") continue;
    try {
      current.set(
        operation.path,
        await readFile(
          resolve(
            chosen.environment.workspaceRoot,
            ...operation.path.split("/"),
          ),
          "utf8",
        ),
      );
    } catch {
      current.set(operation.path, "<current file unavailable>");
    }
  }
  process.stdout.write(
    `\x1b[2J\x1b[H${renderProposalDiff(chosen.item.proposal, current)}\n`,
  );
  const action = await chooseOption(
    "AgentShare - Proposal decision",
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
  const capture =
    source === "codex"
      ? await exportCurrentCodexCapture()
      : await exportCurrentClaudeCapture();
  const approved = await approveOwnedProposal(
    chosen.environment.environmentId,
    chosen.item.proposal.proposalId,
    capture,
    statePath === undefined ? {} : { statePath },
  );
  process.stdout.write(
    `Proposal approved and published as revision ${approved.environment.currentRevisionId}.\n`,
  );
}
