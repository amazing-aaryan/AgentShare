import { refreshAttachedEnvironment } from "../environment/refresh.js";
import { findAttachedEnvironment } from "../environment/state.js";
import type { TargetAgent, TargetResult } from "../launchers.js";
import { runEnvironmentTarget } from "../worker/environment-launcher.js";

export type ProposeEnvironmentOptions = {
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

export async function proposeAttachedEnvironmentChange(
  environmentId: string,
  instruction: string,
  options: ProposeEnvironmentOptions,
): Promise<string> {
  const attached = await findAttachedEnvironment(
    environmentId,
    options.statePath,
  );
  if (attached === undefined) {
    throw new Error(`AgentShare environment is not attached: ${environmentId}`);
  }
  if (attached.proposalCapability === undefined) {
    throw new Error("This AgentShare environment is read-only");
  }
  const runtimeOptions = {
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
    ...(options.cacheRoot === undefined
      ? {}
      : { cacheRoot: options.cacheRoot }),
  };
  await refreshAttachedEnvironment(environmentId, runtimeOptions);
  const runner = options.runner ?? runEnvironmentTarget;
  const result = await runner(
    options.target,
    environmentId,
    buildProposalWorkerPrompt(instruction),
    runtimeOptions,
  );
  if (result.exitCode !== 0) {
    throw new Error(`${options.target} exited with code ${result.exitCode}`);
  }
  return result.output;
}

export function buildProposalWorkerPrompt(instruction: string): string {
  return [
    "You are preparing a proposed update to a read-only AgentShare environment.",
    "Use AgentShare MCP tools only. You have no permission to write the recipient host filesystem, run shell commands, use the network, or mutate UserA's workspace.",
    "Search and read the shared environment as needed.",
    "Use proposal_stage_replace, proposal_stage_create, and proposal_stage_delete to build a proposal overlay. Staging never writes UserA's workspace.",
    "Before submission, call proposal_diff and inspect the staged operations.",
    "When the requested change is coherent, call proposal_submit with a concise summary. UserA must separately approve it before any real workspace mutation occurs.",
    "If the request cannot be completed safely from the shared evidence, do not submit a proposal; explain what is missing.",
    "",
    `Requested change: ${instruction}`,
  ].join("\n");
}
