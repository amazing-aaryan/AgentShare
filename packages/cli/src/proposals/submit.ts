import { createHash } from "node:crypto";
import { encryptProposalForOwner, randomCapability } from "@agentshare/acb";
import {
  proposalSchema,
  type AgentShareProposal,
  type ProposalOperation,
} from "@agentshare/contracts";
import {
  readAttachedFile,
  readAttachedManifest,
  type EnvironmentReadOptions,
} from "../environment/accept.js";
import { EnvironmentRelayClient } from "../environment/relay-client.js";
import { findAttachedEnvironment } from "../environment/state.js";

export type SubmitProposalOptions = EnvironmentReadOptions & {
  client?: EnvironmentRelayClient;
  now?: () => Date;
};

export async function submitFileReplacement(
  environmentId: string,
  path: string,
  content: string,
  summary: string,
  options: SubmitProposalOptions = {},
): Promise<AgentShareProposal> {
  const manifest = await readAttachedManifest(environmentId, options);
  const file = manifest.workspace.files.find(
    (candidate) => candidate.path === path,
  );
  if (file === undefined) throw new Error(`Shared file not found: ${path}`);
  await readAttachedFile(environmentId, path, options);
  return submitProposalOperations(
    environmentId,
    summary,
    [
      {
        type: "replace",
        path,
        baseSha256: file.sha256,
        newSha256: sha256(Buffer.from(content, "utf8")),
        mediaType: file.mediaType,
        contentBase64: Buffer.from(content, "utf8").toString("base64"),
      },
    ],
    options,
  );
}

export async function submitProposalOperations(
  environmentId: string,
  summary: string,
  operations: ProposalOperation[],
  options: SubmitProposalOptions = {},
): Promise<AgentShareProposal> {
  const attached = await findAttachedEnvironment(
    environmentId,
    options.statePath,
  );
  if (attached === undefined) {
    throw new Error(`AgentShare environment is not attached: ${environmentId}`);
  }
  if (attached.currentRevisionId === null) {
    throw new Error("AgentShare environment has no attached revision");
  }
  if (attached.proposalCapability === undefined) {
    throw new Error("This AgentShare environment is read-only");
  }
  const manifest = await readAttachedManifest(environmentId, options);
  if (!manifest.proposalPolicy.enabled) {
    throw new Error("This AgentShare environment does not accept proposals");
  }
  const proposal = proposalSchema.parse({
    version: "agentshare-proposal-v1",
    proposalId: `prop_${randomCapability(18)}`,
    environmentId,
    baseRevisionId: attached.currentRevisionId,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    summary,
    operations,
  });
  const encrypted = encryptProposalForOwner(
    Buffer.from(JSON.stringify(proposal), "utf8"),
    manifest.proposalPolicy.encryptionPublicKey,
    {
      environmentId,
      proposalId: proposal.proposalId,
    },
  );
  const client =
    options.client ?? new EnvironmentRelayClient(attached.relayOrigin);
  await client.submitProposal(
    environmentId,
    attached.proposalCapability,
    {
      proposalId: proposal.proposalId,
      baseRevisionId: proposal.baseRevisionId,
      ciphertextSha256: encrypted.ciphertextSha256,
      ciphertextBytes: encrypted.envelope.byteLength,
      ephemeralPublicKey: encrypted.ephemeralPublicKey,
      createdAt: proposal.createdAt,
    },
    encrypted.envelope,
  );
  return proposal;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
