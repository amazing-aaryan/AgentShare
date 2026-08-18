import {
  decryptProposalForOwner,
  sha256Hex,
  type EncryptedProposal,
} from "@agentshare/acb";
import {
  proposalSchema,
  type AgentShareProposal,
  type ProposalStatus,
} from "@agentshare/contracts";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import { findOwnedEnvironment } from "../environment/state.js";

export type OwnedProposal = {
  proposal: AgentShareProposal;
  status: ProposalStatus;
};

export async function listOwnedProposals(
  environmentId: string,
  options: { client?: EnvironmentRelayClient; statePath?: string } = {},
): Promise<OwnedProposal[]> {
  const owned = await findOwnedEnvironment(environmentId, options.statePath);
  if (owned === undefined) {
    throw new Error(`AgentShare environment is not owned locally: ${environmentId}`);
  }
  const client = options.client ?? new EnvironmentRelayClient(owned.relayOrigin);
  const descriptors = await client.listProposals(
    environmentId,
    owned.inboxCapability,
  );
  const proposals: OwnedProposal[] = [];
  for (const item of descriptors) {
    const bytes = await client.downloadProposal(
      environmentId,
      item.descriptor.proposalId,
      owned.inboxCapability,
    );
    if (
      bytes.byteLength !== item.descriptor.ciphertextBytes ||
      sha256Hex(bytes) !== item.descriptor.ciphertextSha256
    ) {
      throw new Error(
        `Proposal ciphertext descriptor mismatch: ${item.descriptor.proposalId}`,
      );
    }
    const encrypted: EncryptedProposal = {
      environmentId,
      proposalId: item.descriptor.proposalId,
      ephemeralPublicKey: item.descriptor.ephemeralPublicKey,
      envelope: bytes,
      ciphertextSha256: item.descriptor.ciphertextSha256,
    };
    const proposal = proposalSchema.parse(
      JSON.parse(
        Buffer.from(
          decryptProposalForOwner(encrypted, owned.proposalPrivateKey),
        ).toString("utf8"),
      ) as unknown,
    );
    if (
      proposal.environmentId !== environmentId ||
      proposal.proposalId !== item.descriptor.proposalId ||
      proposal.baseRevisionId !== item.descriptor.baseRevisionId
    ) {
      throw new Error(`Proposal identity mismatch: ${item.descriptor.proposalId}`);
    }
    proposals.push({ proposal, status: item.status });
  }
  return proposals;
}
