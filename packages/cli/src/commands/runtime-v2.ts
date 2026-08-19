import { resumePendingRevision } from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import {
  loadEnvironmentState,
  removeOwnedEnvironment,
  type AttachedEnvironment,
} from "../environment/state.js";

export async function latestAttachedEnvironment(
  statePath?: string,
): Promise<AttachedEnvironment> {
  const state = await loadEnvironmentState(statePath);
  const active = state.attachedEnvironments
    .filter((item) => Date.parse(item.expiresAt) > Date.now())
    .sort((left, right) => right.attachedAt.localeCompare(left.attachedAt));
  const latest = active[0];
  if (latest === undefined) {
    throw new Error("No active AgentShare environment is attached");
  }
  return latest;
}

export async function repairOwnedEnvironmentPublications(
  statePath?: string,
): Promise<number> {
  const state = await loadEnvironmentState(statePath);
  let repaired = 0;
  for (const environment of state.ownedEnvironments) {
    if (environment.pendingRevision === undefined) continue;
    await resumePendingRevision(
      environment,
      new EnvironmentRelayClient(environment.relayOrigin),
      statePath,
    );
    repaired += 1;
  }
  return repaired;
}

export async function revokeOwnedEnvironment(
  environmentId: string,
  statePath?: string,
): Promise<void> {
  const state = await loadEnvironmentState(statePath);
  const owned = state.ownedEnvironments.find(
    (environment) => environment.environmentId === environmentId,
  );
  if (owned === undefined) {
    throw new Error(
      `AgentShare environment is not owned locally: ${environmentId}`,
    );
  }
  const client = new EnvironmentRelayClient(owned.relayOrigin);
  await client.revoke(environmentId, owned.revokeCapability);
  await removeOwnedEnvironment(environmentId, statePath);
}
