import type { AgentShareProposal } from "@agentshare/contracts";

export function renderProposalDiff(
  proposal: AgentShareProposal,
  currentFiles: ReadonlyMap<string, string>,
): string {
  const lines = [
    `Proposal: ${proposal.summary}`,
    `Base revision: ${proposal.baseRevisionId}`,
    "",
  ];
  for (const operation of proposal.operations) {
    if (operation.type === "create") {
      lines.push(`A ${operation.path}`);
      lines.push(...prefixed(Buffer.from(operation.contentBase64, "base64").toString("utf8"), "+ "));
      lines.push("");
      continue;
    }
    if (operation.type === "delete") {
      lines.push(`D ${operation.path}`);
      lines.push(...prefixed(currentFiles.get(operation.path) ?? "<unavailable>", "- "));
      lines.push("");
      continue;
    }
    lines.push(`M ${operation.path}`);
    lines.push(...prefixed(currentFiles.get(operation.path) ?? "<unavailable>", "- "));
    lines.push(...prefixed(Buffer.from(operation.contentBase64, "base64").toString("utf8"), "+ "));
    lines.push("");
  }
  return lines.join("\n");
}

function prefixed(text: string, prefix: string): string[] {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => `${prefix}${line}`);
}
