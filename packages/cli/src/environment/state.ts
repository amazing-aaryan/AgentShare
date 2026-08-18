import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type EnvironmentSharePolicy = {
  includeConversation: boolean;
  includeWorkspace: boolean;
  proposalsEnabled: boolean;
};

export type OwnedEnvironment = {
  environmentId: string;
  relayOrigin: string;
  workspaceRoot: string;
  environmentMasterKey: string;
  readCapability: string;
  updateCapability: string;
  proposalCapability?: string;
  inboxCapability: string;
  revokeCapability: string;
  proposalPrivateKey: string;
  currentRevisionId: string | null;
  expiresAt: string;
  sharePolicy: EnvironmentSharePolicy;
  pendingRevision?: {
    revisionId: string;
    parentRevisionId?: string;
    manifestBase64: string;
    manifestSha256: string;
    blobs: Array<{
      blobId: string;
      ciphertextBase64: string;
      ciphertextSha256: string;
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
  version: 2;
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
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<EnvironmentState>;
    if (
      parsed.version !== 2 ||
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
    (item) => item.workspaceRoot === workspaceRoot && Date.parse(item.expiresAt) > Date.now(),
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
  const release = await acquireLock(`${path}.lock`);
  try {
    const state = await loadEnvironmentState(path);
    operation(state);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } finally {
    await release();
  }
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      return () => rm(path, { force: true });
    } catch (error) {
      if (!isLockContention(error)) throw error;
      try {
        if (Date.now() - (await stat(path)).mtimeMs > 30_000) {
          await rm(path, { force: true });
          continue;
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
