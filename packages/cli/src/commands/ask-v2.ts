import type { EnvironmentSearchHit } from "../environment/index.js";
import { searchAttachedEnvironment } from "../environment/accept.js";
import { refreshAttachedEnvironment } from "../environment/refresh.js";
import { runTarget, type TargetAgent, type TargetResult } from "../launchers.js";

export type AskEnvironmentOptions = {
  target: TargetAgent;
  statePath?: string;
  cacheRoot?: string;
  runner?: (target: TargetAgent, prompt: string) => Promise<TargetResult>;
};

export async function askAttachedEnvironment(
  environmentId: string,
  question: string,
  options: AskEnvironmentOptions,
): Promise<string> {
  await refreshAttachedEnvironment(environmentId, {
    ...(options.statePath === undefined ? {} : { statePath: options.statePath }),
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
  const evidence = await searchAttachedEnvironment(environmentId, question, {
    ...(options.statePath === undefined ? {} : { statePath: options.statePath }),
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
  const runner = options.runner ?? runTarget;
  const result = await runner(
    options.target,
    buildEnvironmentEvidencePrompt(question, evidence),
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
    const citation = hit.kind === "file"
      ? `[${hit.source}:L${hit.startLine ?? 1}-L${hit.endLine ?? hit.startLine ?? 1}]`
      : `[${hit.source}]`;
    return `${citation}\n${hit.quote}`;
  });
  return [
    "You are answering a question about a read-only AgentShare environment.",
    "Answer only from the AgentShare evidence below. Do not use external facts, local files, network access, or unsupported assumptions.",
    "Cite every material claim using the supplied bracketed citations.",
    "If the evidence is insufficient, say so explicitly.",
    "",
    `Question: ${question}`,
    "",
    "AgentShare evidence:",
    blocks.length === 0 ? "<no matching evidence>" : blocks.join("\n\n"),
  ].join("\n");
}
