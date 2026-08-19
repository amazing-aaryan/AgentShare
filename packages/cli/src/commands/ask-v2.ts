import type { EnvironmentSearchHit } from "../environment/index.js";
import { searchAttachedEnvironment } from "../environment/accept.js";
import { refreshAttachedEnvironment } from "../environment/refresh.js";
import type { TargetAgent, TargetResult } from "../launchers.js";
import { runEnvironmentTarget } from "../worker/environment-launcher.js";

export type AskEnvironmentOptions = {
  target: TargetAgent;
  statePath?: string;
  cacheRoot?: string;
  runner?: (
    target: TargetAgent,
    environmentId: string,
    prompt: string,
    runtimeOptions: { statePath?: string; cacheRoot?: string },
  ) => Promise<TargetResult>;
};

export async function askAttachedEnvironment(
  environmentId: string,
  question: string,
  options: AskEnvironmentOptions,
): Promise<string> {
  const runtimeOptions = {
    ...(options.statePath === undefined ? {} : { statePath: options.statePath }),
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
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
    "You may use only the AgentShare MCP tools. Do not use external facts, local host files, network access, shell commands, or unsupported assumptions.",
    "Use search/read_file/read_conversation as needed to inspect more shared evidence.",
    "Cite every material claim with shared file line references or conversation event references.",
    "If the evidence is insufficient, say so explicitly.",
    "",
    `Question: ${question}`,
    "",
    "Initial AgentShare evidence:",
    blocks.length === 0 ? "<no matching evidence; use AgentShare search>" : blocks.join("\n\n"),
  ].join("\n");
}
