import { createHash, randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildEnvironmentUrl, keyFromFragment } from "@agentshare/acb";
import { MAX_TTL_SECONDS } from "@agentshare/contracts";
import {
  previewEnvironmentCapture,
  verifyPreparedCapture,
  type PreparedCapture,
} from "./preview.js";
import {
  createEnvironmentFromCapture,
  publishEnvironmentRevision,
  resumePendingRevision,
  type HostCapture,
  type PublicationSummary,
} from "./publication.js";
import { EnvironmentRelayClient } from "./relay-client.js";
import {
  defaultEnvironmentStatePath,
  findOwnedEnvironment,
  withEnvironmentLock,
  type EnvironmentSharePolicy,
} from "./state.js";
import { readPrivateJson, writePrivateJson } from "./private-store.js";

export type DraftTarget =
  | { kind: "new" }
  | { kind: "update"; environmentId: string; expectedBaseRevisionId: string };
export type ShareDraft = {
  version: 1;
  draftId: string;
  sessionRef: string;
  recordedRoot: string;
  target: DraftTarget;
  relayOrigin: string;
  handoffOrigin: string;
  policy: EnvironmentSharePolicy;
  ttlSeconds: number;
  existingExpiresAt?: string;
  createdAt: string;
  approvalExpiresAt: string;
  prepared: PreparedCapture;
};
type DraftRecord = {
  draft: ShareDraft;
  digest: string;
  status: "prepared" | "publishing" | "published";
  environmentId?: string;
  revisionId?: string;
  expectedRevisionId?: string;
  summary?: PublicationSummary;
};
export type DraftOptions = {
  statePath?: string;
  now?: () => Date;
  client?: EnvironmentRelayClient;
};
export type DraftReview = {
  draftId: string;
  digest: string;
  approvalExpiresAt: string;
  sessionRef: string;
  recordedRoot: string;
  selectedRoot: string;
  relayOrigin: string;
  target: DraftTarget;
  policy: EnvironmentSharePolicy;
  ttlSeconds: number;
  existingExpiresAt?: string;
  summary: PublicationSummary;
};

export async function prepareShareDraft(
  capture: HostCapture,
  options: DraftOptions & {
    sessionRef: string;
    recordedRoot?: string;
    target: DraftTarget;
    policy: EnvironmentSharePolicy;
    ttlSeconds: number;
    relayOrigin: string;
    handoffOrigin: string;
    workspaceOptions?: { preferGit?: boolean; maxFileBytes?: number };
  },
): Promise<DraftReview> {
  const now = (options.now ?? (() => new Date()))();
  if (
    !Number.isInteger(options.ttlSeconds) ||
    options.ttlSeconds < 1 ||
    options.ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw new Error("Invalid share lifetime");
  }
  const relayOrigin = new EnvironmentRelayClient(options.relayOrigin).origin;
  const handoffOrigin = new EnvironmentRelayClient(options.handoffOrigin)
    .origin;
  if (options.client !== undefined && options.client.origin !== relayOrigin)
    throw new Error("Draft relay mismatch");
  let existingExpiresAt: string | undefined;
  if (options.target.kind === "update") {
    const owned = await findOwnedEnvironment(
      options.target.environmentId,
      options.statePath,
    );
    if (
      owned?.currentRevisionId !== options.target.expectedBaseRevisionId ||
      owned.relayOrigin !== relayOrigin ||
      owned.pendingRevision !== undefined ||
      JSON.stringify(owned.sharePolicy) !== JSON.stringify(options.policy) ||
      Date.parse(owned.expiresAt) <= now.getTime()
    ) {
      throw new Error("Update target, base or policy changed; prepare again");
    }
    existingExpiresAt = owned.expiresAt;
  }
  await cleanAbandonedDrafts(options);
  const draft: ShareDraft = {
    version: 1,
    draftId: `draft_${randomUUID()}`,
    sessionRef: options.sessionRef,
    recordedRoot: options.recordedRoot ?? capture.workspaceRoot,
    target: options.target,
    relayOrigin,
    handoffOrigin,
    policy: options.policy,
    ttlSeconds:
      existingExpiresAt === undefined
        ? options.ttlSeconds
        : Math.ceil((Date.parse(existingExpiresAt) - now.getTime()) / 1000),
    ...(existingExpiresAt === undefined ? {} : { existingExpiresAt }),
    createdAt: now.toISOString(),
    approvalExpiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    prepared: await previewEnvironmentCapture(capture, {
      ...options.policy,
      ...(options.workspaceOptions === undefined
        ? {}
        : { workspaceOptions: options.workspaceOptions }),
    }),
  };
  const record: DraftRecord = {
    draft,
    digest: digestOf(draft),
    status: "prepared",
  };
  await writePrivateJson(
    draftRoot(options.statePath),
    `${draft.draftId}.enc`,
    record,
  );
  return review(record);
}

export async function readShareDraft(
  draftId: string,
  digest: string,
  options: DraftOptions = {},
): Promise<ShareDraft> {
  const record = await load(draftId, options);
  if (record.digest !== digest)
    throw new Error("Draft digest mismatch; review again");
  return record.draft;
}

/** confirm is supplied by the trusted TTY/MCP transport, never a model argument. */
export async function commitShareDraft(
  draftId: string,
  digest: string,
  options: DraftOptions & {
    confirm: (review: DraftReview) => Promise<boolean>;
  },
): Promise<{
  environmentId: string;
  revisionId: string;
  url: string;
  summary: PublicationSummary;
}> {
  return withEnvironmentLock(draftId, options.statePath, async () => {
    const record = await load(draftId, options);
    if (record.digest !== digest)
      throw new Error("Draft digest mismatch; review again");
    if (record.status !== "published") {
      if (
        Date.parse(record.draft.approvalExpiresAt) <=
        (options.now ?? (() => new Date()))().getTime()
      ) {
        throw new Error("Draft approval expired; prepare and review again");
      }
      if (!(await options.confirm(review(record))))
        throw new Error(
          "AgentShare cancelled; no publication attempted by this call",
        );
      // Revalidate after human input; preparation alone never authorizes publication.
      const checked = await load(draftId, options);
      if (
        checked.digest !== digest ||
        Date.parse(checked.draft.approvalExpiresAt) <=
          (options.now ?? (() => new Date()))().getTime()
      ) {
        throw new Error("Draft changed or expired during approval");
      }
      const draft = record.draft;
      const client =
        options.client ?? new EnvironmentRelayClient(draft.relayOrigin);
      if (client.origin !== draft.relayOrigin)
        throw new Error("Draft relay mismatch");
      const resumed =
        record.environmentId === undefined
          ? undefined
          : await findOwnedEnvironment(record.environmentId, options.statePath);
      if (record.environmentId !== undefined && resumed === undefined) {
        throw new Error(
          "Draft ownership was removed; refusing to create another share",
        );
      }
      if (record.status === "publishing" && resumed !== undefined) {
        if (
          record.expectedRevisionId === undefined ||
          (resumed.pendingRevision?.reservation.revisionId ??
            resumed.currentRevisionId) !== record.expectedRevisionId
        ) {
          throw new Error(
            "Draft publication cannot be matched to pending revision; explicit recovery required",
          );
        }
        const owned = await resumePendingRevision(
          resumed,
          client,
          options.statePath,
          record.expectedRevisionId,
        );
        if (owned.currentRevisionId !== record.expectedRevisionId)
          throw new Error("Publication recovery receipt mismatch");
        record.environmentId = owned.environmentId;
        record.revisionId = owned.currentRevisionId;
        record.summary = draft.prepared.summary;
      } else if (draft.target.kind === "new") {
        record.status = "publishing";
        const created = await createEnvironmentFromCapture(
          draft.prepared.capture,
          {
            ...draft.policy,
            ttlSeconds: draft.ttlSeconds,
            client,
            preparedCapture: draft.prepared,
            ...(options.statePath === undefined
              ? {}
              : { statePath: options.statePath }),
            ...(options.now === undefined ? {} : { now: options.now }),
            onPreparedEnvironment: async (id, revisionId) => {
              record.environmentId = id;
              record.expectedRevisionId = revisionId;
              await save(record, options);
            },
          },
        );
        record.environmentId = created.environment.environmentId;
        if (created.environment.currentRevisionId === null)
          throw new Error("Publication has no committed revision");
        record.revisionId = created.environment.currentRevisionId;
        record.summary = created.summary;
      } else {
        const owned = await findOwnedEnvironment(
          draft.target.environmentId,
          options.statePath,
        );
        if (
          owned?.currentRevisionId !== draft.target.expectedBaseRevisionId ||
          owned.pendingRevision !== undefined ||
          JSON.stringify(owned.sharePolicy) !== JSON.stringify(draft.policy)
        ) {
          throw new Error("Update base changed; prepare and review again");
        }
        record.status = "publishing";
        record.environmentId = owned.environmentId;
        await save(record, options);
        const published = await publishEnvironmentRevision(
          draft.prepared.capture,
          owned,
          client,
          {
            preparedCapture: draft.prepared,
            approvedWorkspaceRoot: draft.prepared.capture.workspaceRoot,
            onPreparedRevision: async (id, revisionId) => {
              record.environmentId = id;
              record.expectedRevisionId = revisionId;
              await save(record, options);
            },
            ...(options.statePath === undefined
              ? {}
              : { statePath: options.statePath }),
            ...(options.now === undefined ? {} : { now: options.now() }),
          },
        );
        if (published.environment.currentRevisionId === null)
          throw new Error("Publication has no committed revision");
        record.revisionId = published.environment.currentRevisionId;
        record.summary = published.summary;
      }
      record.status = "published";
      await save(record, options);
    }
    if (
      record.environmentId === undefined ||
      record.revisionId === undefined ||
      record.summary === undefined
    ) {
      throw new Error("Publication receipt incomplete; recovery required");
    }
    const owned = await findOwnedEnvironment(
      record.environmentId,
      options.statePath,
    );
    if (owned === undefined)
      throw new Error("Published environment no longer owned locally");
    return {
      environmentId: owned.environmentId,
      revisionId: record.revisionId,
      summary: record.summary,
      url: buildEnvironmentUrl({
        handoffOrigin: record.draft.handoffOrigin,
        relayOrigin: owned.relayOrigin,
        environmentId: owned.environmentId,
        readCapability: owned.readCapability,
        environmentMasterKey: keyFromFragment(owned.environmentMasterKey),
        ...(owned.proposalCapability === undefined
          ? {}
          : { proposalCapability: owned.proposalCapability }),
      }),
    };
  });
}

export async function shareDraftStatus(
  draftId: string,
  options: DraftOptions = {},
) {
  const record = await load(draftId, options);
  return {
    status: record.status,
    draftId,
    environmentId: record.environmentId,
    revisionId: record.revisionId,
    approvalExpiresAt: record.draft.approvalExpiresAt,
  };
}

export async function cleanAbandonedDrafts(
  options: DraftOptions = {},
): Promise<number> {
  const root = draftRoot(options.statePath);
  const names = await readdir(root).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    if (!/^draft_[a-f0-9-]+\.enc$/u.test(name)) continue;
    const id = name.slice(0, -4);
    await withEnvironmentLock(id, options.statePath, async () => {
      const record = await load(id, options);
      if (
        record.status !== "publishing" &&
        Date.parse(record.draft.createdAt) + 86_400_000 <
          (options.now ?? (() => new Date()))().getTime()
      ) {
        await rm(join(root, name));
        removed += 1;
      }
    });
  }
  return removed;
}

async function load(id: string, options: DraftOptions): Promise<DraftRecord> {
  if (!/^draft_[a-f0-9-]+$/u.test(id)) throw new Error("Invalid draft ID");
  const raw = (await readPrivateJson(
    draftRoot(options.statePath),
    `${id}.enc`,
  )) as Partial<DraftRecord>;
  if (
    raw.draft?.version !== 1 ||
    raw.draft.draftId !== id ||
    raw.digest !== digestOf(raw.draft) ||
    !["prepared", "publishing", "published"].includes(String(raw.status))
  )
    throw new Error("Draft integrity failed");
  const record = raw as DraftRecord;
  verifyPreparedCapture(record.draft.prepared);
  return record;
}
function save(record: DraftRecord, options: DraftOptions): Promise<void> {
  return writePrivateJson(
    draftRoot(options.statePath),
    `${record.draft.draftId}.enc`,
    record,
  );
}
function digestOf(draft: ShareDraft): string {
  return createHash("sha256").update(JSON.stringify(draft)).digest("hex");
}
function draftRoot(statePath = defaultEnvironmentStatePath()): string {
  return join(dirname(statePath), ".agentshare", "drafts-v1");
}
function review({ draft, digest }: DraftRecord): DraftReview {
  return {
    draftId: draft.draftId,
    digest,
    approvalExpiresAt: draft.approvalExpiresAt,
    sessionRef: draft.sessionRef,
    recordedRoot: draft.recordedRoot,
    selectedRoot: draft.prepared.capture.workspaceRoot,
    relayOrigin: draft.relayOrigin,
    target: draft.target,
    policy: draft.policy,
    ttlSeconds: draft.ttlSeconds,
    ...(draft.existingExpiresAt === undefined
      ? {}
      : { existingExpiresAt: draft.existingExpiresAt }),
    summary: draft.prepared.summary,
  };
}
