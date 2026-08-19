import { buildEnvironmentUrl, keyFromFragment } from "@agentshare/acb";
import { acceptEnvironmentLink, type EnvironmentReadOptions } from "./accept.js";
import { EnvironmentRelayClient } from "./relay-client.js";
import { findAttachedEnvironment } from "./state.js";

export async function refreshAttachedEnvironment(
  environmentId: string,
  options: EnvironmentReadOptions & { client?: EnvironmentRelayClient } = {},
): Promise<boolean> {
  const attached = await findAttachedEnvironment(environmentId, options.statePath);
  if (attached === undefined) {
    throw new Error(`AgentShare environment is not attached: ${environmentId}`);
  }
  const client = options.client ?? new EnvironmentRelayClient(attached.relayOrigin);
  const metadata = await client.metadata(environmentId, attached.readCapability);
  if (metadata.currentRevisionId === attached.currentRevisionId) return false;
  if (metadata.currentRevisionId === null) {
    throw new Error("AgentShare environment has no committed revision");
  }
  const link = buildEnvironmentUrl({
    origin: attached.relayOrigin,
    environmentId,
    readCapability: attached.readCapability,
    environmentMasterKey: keyFromFragment(attached.environmentMasterKey),
    ...(attached.proposalCapability === undefined
      ? {}
      : { proposalCapability: attached.proposalCapability }),
  });
  await acceptEnvironmentLink(link, {
    client,
    ...(options.statePath === undefined ? {} : { statePath: options.statePath }),
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
  return true;
}
