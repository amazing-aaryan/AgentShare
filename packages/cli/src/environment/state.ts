import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ensurePrivateDirectory, securePrivatePath } from "./private-store.js";
import type {
  CiphertextDescriptor,
  ReserveRevisionRequest,
} from "@agentshare/contracts";

export type EnvironmentSharePolicy = {
  includeConversation: boolean;
  includeWorkspace: boolean;
  proposalsEnabled: boolean;
};

export type OwnedEnvironment = {
  generation?: number;
  committedManifestBase64?: string;
  creationRequest?: import("@agentshare/contracts").CreateEnvironmentRequest;
  environmentId: string;
  relayOrigin: string;
  workspaceRoot: string;
  environmentMasterKey: string;
  readCapability: string;
  updateCapability: string;
  proposalCapability?: string;
  inboxCapability: string;
  revokeCapability: string;
  proposalPublicKey?: string;
  proposalPrivateKey: string;
  currentRevisionId: string | null;
  expiresAt: string;
  sharePolicy: EnvironmentSharePolicy;
  knownBlobs?: Record<string, CiphertextDescriptor>;
  pendingRevision?: {
    workspaceRoot?: string;
    reservation: ReserveRevisionRequest;
    manifestBase64: string;
    proposalId?: string;
    blobs: Array<{
      blobId: string;
      ciphertextBase64: string;
    }>;
  };
};

export type AttachedEnvironment = {
  environmentId: string;
  relayOrigin: string;
  environmentMasterKey: string;
  readCapability: string;
  proposalCapability?: string;
  currentRevisionId: string | null;
  expiresAt: string;
  attachedAt: string;
  title: string;
};

export type ApplyTransaction = {
  proposalId: string;
  environmentId: string;
  workspaceRoot: string;
  status: "prepared" | "applied-local" | "published";
  createdAt: string;
};

export type EnvironmentState = {
  version: 2 | 3;
  generation?: number;
  removedEnvironmentIds?: string[];
  ownedEnvironments: OwnedEnvironment[];
  attachedEnvironments: AttachedEnvironment[];
  transactions: ApplyTransaction[];
};

export function defaultEnvironmentStatePath(): string {
  return join(homedir(), ".agentshare", "state-v2.json");
}

export async function loadEnvironmentState(
  path = defaultEnvironmentStatePath(),
): Promise<EnvironmentState> {
  try {
    const parsed = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<EnvironmentState>;
    if (
      (parsed.version !== 2 && parsed.version !== 3) ||
      !Array.isArray(parsed.ownedEnvironments) ||
      !Array.isArray(parsed.attachedEnvironments) ||
      !Array.isArray(parsed.transactions)
    ) {
      throw new Error("Invalid AgentShare v2 state");
    }
    return parsed as EnvironmentState;
  } catch (error) {
    if (isNotFound(error)) {
      return {
        version: 2,
        ownedEnvironments: [],
        attachedEnvironments: [],
        transactions: [],
      };
    }
    throw error;
  }
}

export async function saveOwnedEnvironment(
  environment: OwnedEnvironment,
  path = defaultEnvironmentStatePath(),
): Promise<void> {
  await mutate(path, (state) => {
    const previous = state.ownedEnvironments.find(
      (item) => item.environmentId === environment.environmentId,
    );
    if (
      previous === undefined &&
      ((environment.generation ?? 0) !== 0 ||
        state.removedEnvironmentIds?.includes(environment.environmentId))
    ) {
      throw new Error(
        "Owned environment was removed; refusing stale resurrection",
      );
    }
    if (
      previous !== undefined &&
      (previous.generation ?? 0) !== (environment.generation ?? 0)
    ) {
      throw new Error(
        "Environment changed concurrently; reload before retrying",
      );
    }
    environment.generation = (previous?.generation ?? 0) + 1;
    state.ownedEnvironments = state.ownedEnvironments.filter(
      (item) => item.environmentId !== environment.environmentId,
    );
    state.ownedEnvironments.push(environment);
  });
}

export async function saveAttachedEnvironment(
  environment: AttachedEnvironment,
  path = defaultEnvironmentStatePath(),
): Promise<void> {
  await mutate(path, (state) => {
    state.attachedEnvironments = state.attachedEnvironments.filter(
      (item) => item.environmentId !== environment.environmentId,
    );
    state.attachedEnvironments.push(environment);
  });
}

export async function findOwnedEnvironment(
  environmentId: string,
  path = defaultEnvironmentStatePath(),
): Promise<OwnedEnvironment | undefined> {
  return (await loadEnvironmentState(path)).ownedEnvironments.find(
    (item) => item.environmentId === environmentId,
  );
}

export async function findOwnedEnvironmentForWorkspace(
  workspaceRoot: string,
  path = defaultEnvironmentStatePath(),
): Promise<OwnedEnvironment | undefined> {
  return (await loadEnvironmentState(path)).ownedEnvironments.find(
    (item) =>
      item.workspaceRoot === workspaceRoot &&
      Date.parse(item.expiresAt) > Date.now(),
  );
}

export async function findAttachedEnvironment(
  environmentId: string,
  path = defaultEnvironmentStatePath(),
): Promise<AttachedEnvironment | undefined> {
  return (await loadEnvironmentState(path)).attachedEnvironments.find(
    (item) => item.environmentId === environmentId,
  );
}

export async function removeOwnedEnvironment(
  environmentId: string,
  path = defaultEnvironmentStatePath(),
): Promise<void> {
  await mutate(path, (state) => {
    state.removedEnvironmentIds = [
      ...new Set([...(state.removedEnvironmentIds ?? []), environmentId]),
    ];
    state.ownedEnvironments = state.ownedEnvironments.filter(
      (item) => item.environmentId !== environmentId,
    );
  });
}

export async function saveTransaction(
  transaction: ApplyTransaction,
  path = defaultEnvironmentStatePath(),
): Promise<void> {
  await mutate(path, (state) => {
    state.transactions = state.transactions.filter(
      (item) => item.proposalId !== transaction.proposalId,
    );
    state.transactions.push(transaction);
  });
}

export async function removeTransaction(
  proposalId: string,
  path = defaultEnvironmentStatePath(),
): Promise<void> {
  await mutate(path, (state) => {
    state.transactions = state.transactions.filter(
      (item) => item.proposalId !== proposalId,
    );
  });
}

async function mutate(
  path: string,
  operation: (state: EnvironmentState) => void,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Harden a dedicated staging directory, never the user's arbitrary parent folder.
  const staging = join(dirname(path), ".agentshare-private");
  await ensurePrivateDirectory(staging);
  const release = await acquireLock(`${path}.lock`);
  try {
    const state = await loadEnvironmentState(path);
    try {
      await securePrivatePath(path);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (state.version === 2) {
      try {
        const backup = `${path}.v2-backup`;
        try {
          await securePrivatePath(backup);
        } catch (error) {
          if (!isNotFound(error)) throw error;
          const protectedBackup = join(staging, `${randomUUID()}.backup`);
          await writeFile(protectedBackup, await readFile(path), {
            flag: "wx",
            mode: 0o600,
          });
          await securePrivatePath(protectedBackup);
          await rename(protectedBackup, backup);
        }
      } catch (error) {
        if (
          !isNotFound(error) &&
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error;
      }
      state.version = 3;
    }
    operation(state);
    state.generation = (state.generation ?? 0) + 1;
    const temporary = join(staging, `${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await securePrivatePath(temporary);
    await rename(temporary, path);
  } finally {
    await release();
  }
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      const token = `${process.pid}:${randomUUID()}`;
      await handle.writeFile(token, "utf8");
      await handle.close();
      return async () => {
        if ((await readFile(path, "utf8").catch(() => "")) === token)
          await rm(path, { force: true });
      };
    } catch (error) {
      if (!isLockContention(error)) throw error;
      try {
        const token = await readFile(path, "utf8");
        const pid = Number(token.trim().split(":")[0]);
        if (Number.isSafeInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (probe) {
            if (
              probe instanceof Error &&
              "code" in probe &&
              probe.code === "ESRCH"
            ) {
              // Unlink-after-read is racy: another contender could own the replacement.
              // Fail closed; recover this exact abandoned lock with all writers stopped.
              throw new Error(
                `Abandoned AgentShare lock requires explicit recovery with writers stopped: ${path}`,
                { cause: probe },
              );
            }
          }
        }
      } catch (statError) {
        if (isNotFound(statError)) continue;
        throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out acquiring AgentShare v2 state lock: ${path}`);
}

const heldEnvironmentLocks = new AsyncLocalStorage<ReadonlySet<string>>();

export async function withEnvironmentLock<T>(
  environmentId: string,
  statePath: string | undefined,
  action: () => Promise<T>,
): Promise<T> {
  const state = statePath ?? defaultEnvironmentStatePath();
  const key = `${state}\0${environmentId}`;
  if (heldEnvironmentLocks.getStore()?.has(key)) return action();
  await mkdir(dirname(state), { recursive: true, mode: 0o700 });
  const release = await acquireLock(
    `${state}.${createHash("sha256").update(environmentId).digest("hex")}.operation.lock`,
  );
  try {
    return await heldEnvironmentLocks.run(
      new Set([...(heldEnvironmentLocks.getStore() ?? []), key]),
      action,
    );
  } finally {
    await release();
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isLockContention(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    ["EEXIST", "EPERM", "EBUSY"].includes(String(error.code))
  );
}
