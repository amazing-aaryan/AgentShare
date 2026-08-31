import { resumePendingRevision } from "../environment/publication.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import {
  loadEnvironmentState,
  removeOwnedEnvironment,
  withEnvironmentLock,
  type AttachedEnvironment,
} from "../environment/state.js";

export async function latestAttachedEnvironment(
  statePath?: string,
): Promise<AttachedEnvironment> {
  const state = await loadEnvironmentState(statePath);
  const active = state.attachedEnvironments.filter(
    (item) => Date.parse(item.expiresAt) > Date.now(),
  );
  if (active.length > 1)
    throw new Error(
      "Multiple environments attached; select an explicit --environment",
    );
  const latest = active[0];
  if (latest === undefined) {
    throw new Error("No active AgentShare environment is attached");
  }
  return latest;
}

export async function repairOwnedEnvironmentPublications(
  statePath?: string,
  environmentId?: string,
): Promise<number> {
  if (environmentId === undefined)
    throw new Error(
      "Scoped recovery requires --environment; no publications were touched",
    );
  return withEnvironmentLock(environmentId, statePath, async () => {
    const state = await loadEnvironmentState(statePath);
    const environment = state.ownedEnvironments.find(
      (item) => item.environmentId === environmentId,
    );
    if (environment === undefined)
      throw new Error("Selected environment is not owned locally");
    if (environment.pendingRevision === undefined) return 0;
    await resumePendingRevision(
      environment,
      new EnvironmentRelayClient(environment.relayOrigin),
      statePath,
    );
    return 1;
  });
}

export async function revokeOwnedEnvironment(
  environmentId: string,
  statePath?: string,
): Promise<void> {
  await withEnvironmentLock(environmentId, statePath, async () => {
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
  });
}
