import type { EnvironmentSearchHit } from "../environment/index.js";
import { searchAttachedEnvironment } from "../environment/accept.js";
import { refreshAttachedEnvironment } from "../environment/refresh.js";
import type { TargetAgent } from "../launchers.js";
import {
  runEnvironmentTarget,
  type EnvironmentRuntimeOptions,
  type EnvironmentTargetResult,
} from "../worker/environment-launcher.js";
import { hasRequiredCompletion } from "../worker/completion.js";

export type AskEnvironmentOptions = {
  target: TargetAgent;
  statePath?: string;
  cacheRoot?: string;
  runner?: (
    target: TargetAgent,
    environmentId: string,
    prompt: string,
    runtimeOptions: EnvironmentRuntimeOptions,
  ) => Promise<EnvironmentTargetResult>;
};

export async function askAttachedEnvironment(
  environmentId: string,
  question: string,
  options: AskEnvironmentOptions,
): Promise<string> {
  const runtimeOptions = {
    mode: "ask" as const,
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
    ...(options.cacheRoot === undefined
      ? {}
      : { cacheRoot: options.cacheRoot }),
  };
  await refreshAttachedEnvironment(environmentId, runtimeOptions);
  const evidence = await searchAttachedEnvironment(
    environmentId,
    question,
    runtimeOptions,
  );
  const runner = options.runner ?? runEnvironmentTarget;
  const result = await runner(
    options.target,
    environmentId,
    buildEnvironmentEvidencePrompt(question, evidence),
    runtimeOptions,
  );
  if (result.exitCode !== 0) {
    throw new Error(`${options.target} exited with code ${result.exitCode}`);
  }
  if (!hasRequiredCompletion(result.receipts, "ask", environmentId)) {
    throw new Error(
      "AgentShare ask failed: no completed shared file or conversation read receipt",
    );
  }
  if (result.output.trim().length === 0)
    throw new Error("AgentShare ask returned no answer");
  return result.output;
}

export function buildEnvironmentEvidencePrompt(
  question: string,
  evidence: EnvironmentSearchHit[],
): string {
  const blocks = evidence.map((hit) => {
    const citation =
      hit.kind === "file"
        ? `[${hit.source}:L${hit.startLine ?? 1}-L${hit.endLine ?? hit.startLine ?? 1}]`
        : `[${hit.source}]`;
    return `${citation}\n${hit.quote}`;
  });
  return [
    "You are answering a question about a read-only AgentShare environment.",
    "Answer only from the AgentShare evidence available through the AgentShare MCP tools. Do not use external facts, local host files, network access, shell commands, or unsupported assumptions.",
    "You must call read_file or read_conversation and successfully read relevant nonempty shared evidence before answering. Search, environment_info, list_files, and this initial evidence alone do not complete the request.",
    "Cite every material claim with shared file line references or conversation event references.",
    "If the evidence is insufficient, say so explicitly.",
    "",
    `Question: ${question}`,
    "",
    "Initial AgentShare evidence:",
    blocks.length === 0
      ? "<no matching evidence; use AgentShare search>"
      : blocks.join("\n\n"),
  ].join("\n");
}
