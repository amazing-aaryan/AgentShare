import { appendFile, readFile, stat } from "node:fs/promises";

export type EnvironmentMode = "ask" | "propose";
export const READ_TOOL_NAMES = [
  "environment_info",
  "list_files",
  "search",
  "read_file",
  "read_conversation",
] as const;
export const PROPOSAL_TOOL_NAMES = [
  "proposal_stage_replace",
  "proposal_stage_create",
  "proposal_stage_delete",
  "proposal_diff",
  "proposal_submit",
] as const;

export function environmentToolNames(mode: EnvironmentMode): string[] {
  return mode === "ask"
    ? [...READ_TOOL_NAMES]
    : [...READ_TOOL_NAMES, ...PROPOSAL_TOOL_NAMES];
}

// Written only by the trusted MCP process, never parsed from agent output.
// No arguments, file contents, conversations, summaries, or capabilities persist here.
export type McpCompletionReceipt = {
  version: 1;
  runId: string;
  environmentId: string;
  mode: EnvironmentMode;
  tool: string;
  status: "completed" | "failed";
  revisionId?: string;
  evidenceItems: number;
  proposalId?: string;
};

export type ReceiptChannel = {
  revisionId?: string;
  path: string;
  runId: string;
  environmentId: string;
  mode: EnvironmentMode;
};

export async function recordMcpCompletion(
  channel: ReceiptChannel,
  tool: string,
  value: unknown,
): Promise<void> {
  if (!environmentToolNames(channel.mode).includes(tool))
    throw new Error("Tool outside worker allowlist");
  const evidenceItems =
    tool === "read_file"
      ? typeof value === "string" && value.trim().length > 0
        ? 1
        : 0
      : tool === "read_conversation" && Array.isArray(value)
        ? value.filter(
            (event: unknown) =>
              typeof event === "object" &&
              event !== null &&
              "text" in event &&
              typeof event.text === "string" &&
              event.text.trim().length > 0,
          ).length
        : 0;
  let proposalId: string | undefined;
  if (tool === "proposal_submit") {
    if (
      typeof value !== "object" ||
      value === null ||
      !("proposalId" in value) ||
      typeof value.proposalId !== "string" ||
      !/^prop_[A-Za-z0-9_-]+$/u.test(value.proposalId)
    ) {
      throw new Error("Proposal submission did not return a receipt ID");
    }
    proposalId = value.proposalId;
  }
  const receipt: McpCompletionReceipt = {
    version: 1,
    runId: channel.runId,
    environmentId: channel.environmentId,
    mode: channel.mode,
    tool,
    status: "completed",
    ...(channel.revisionId === undefined
      ? {}
      : { revisionId: channel.revisionId }),
    evidenceItems,
    ...(proposalId === undefined ? {} : { proposalId }),
  };
  await appendFile(channel.path, `${JSON.stringify(receipt)}\n`, {
    mode: 0o600,
  });
}

export async function recordMcpFailure(
  channel: ReceiptChannel,
  tool: string,
): Promise<void> {
  const receipt: McpCompletionReceipt = {
    version: 1,
    runId: channel.runId,
    environmentId: channel.environmentId,
    mode: channel.mode,
    tool,
    status: "failed",
    evidenceItems: 0,
    ...(channel.revisionId === undefined
      ? {}
      : { revisionId: channel.revisionId }),
  };
  await appendFile(channel.path, `${JSON.stringify(receipt)}\n`, {
    mode: 0o600,
  });
}

export async function readMcpCompletions(
  channel: ReceiptChannel,
): Promise<McpCompletionReceipt[]> {
  try {
    if ((await stat(channel.path)).size > 262_144)
      throw new Error("MCP receipt limit exceeded");
    const lines = (await readFile(channel.path, "utf8")).trim();
    if (lines.length === 0) return [];
    return lines.split("\n").map((line) => {
      const receipt: unknown = JSON.parse(line);
      if (
        !isCompletionReceipt(receipt) ||
        receipt.runId !== channel.runId ||
        receipt.environmentId !== channel.environmentId ||
        receipt.mode !== channel.mode ||
        !environmentToolNames(channel.mode).includes(receipt.tool) ||
        !Number.isSafeInteger(receipt.evidenceItems) ||
        receipt.evidenceItems < 0
      ) {
        throw new Error("Invalid MCP completion receipt");
      }
      return receipt;
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}

export function hasRequiredCompletion(
  receipts: McpCompletionReceipt[] | undefined,
  mode: EnvironmentMode,
  environmentId: string,
): boolean {
  if (receipts?.some((receipt) => receipt.status === "failed")) return false;
  return (
    receipts?.some(
      (receipt) =>
        isCompletionReceipt(receipt) &&
        receipt.status === "completed" &&
        receipt.environmentId === environmentId &&
        receipt.mode === mode &&
        (mode === "ask"
          ? ["read_file", "read_conversation"].includes(receipt.tool) &&
            receipt.evidenceItems > 0
          : receipt.tool === "proposal_submit" &&
            typeof receipt.proposalId === "string" &&
            /^prop_[A-Za-z0-9_-]+$/u.test(receipt.proposalId)),
    ) ?? false
  );
}

function isCompletionReceipt(value: unknown): value is McpCompletionReceipt {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return (
    receipt.version === 1 &&
    (receipt.status === "completed" || receipt.status === "failed") &&
    typeof receipt.runId === "string" &&
    receipt.runId.length > 0 &&
    typeof receipt.environmentId === "string" &&
    (receipt.mode === "ask" || receipt.mode === "propose") &&
    typeof receipt.tool === "string" &&
    typeof receipt.evidenceItems === "number" &&
    Number.isSafeInteger(receipt.evidenceItems) &&
    receipt.evidenceItems >= 0 &&
    (receipt.proposalId === undefined ||
      (typeof receipt.proposalId === "string" &&
        /^prop_[A-Za-z0-9_-]+$/u.test(receipt.proposalId)))
  );
}
