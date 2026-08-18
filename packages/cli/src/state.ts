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

export type LocalShare = {
  fingerprint: string;
  relayOrigin: string;
  shareId: string;
  url: string;
  revokeCapability: string;
  expiresAt: string;
  pendingUpload?: {
    uploadCapability: string;
    ciphertextSha256: string;
    envelopeBase64: string;
  };
};

type LocalState = { version: 1; shares: LocalShare[] };
type UntrustedLocalState = { version?: unknown; shares?: unknown };

export function defaultStatePath(): string {
  return join(homedir(), ".agentshare", "state-v1.json");
}

export async function loadState(
  path = defaultStatePath(),
): Promise<LocalState> {
  try {
    const parsed = JSON.parse(
      await readFile(path, "utf8"),
    ) as UntrustedLocalState;
    if (parsed.version !== 1 || !Array.isArray(parsed.shares))
      throw new Error("Invalid state");
    if (!parsed.shares.every(isLocalShare)) throw new Error("Invalid state");
    return { version: 1, shares: parsed.shares };
  } catch (error) {
    if (isNotFound(error)) return { version: 1, shares: [] };
    throw error;
  }
}

export async function saveShare(
  share: LocalShare,
  path = defaultStatePath(),
): Promise<void> {
  await mutateState(path, (state) => {
    state.shares = state.shares.filter(
      (item) =>
        !(
          item.shareId === share.shareId &&
          item.relayOrigin === share.relayOrigin
        ),
    );
    state.shares.push(share);
  });
}

export async function removeShareByUrl(
  url: string,
  path = defaultStatePath(),
): Promise<void> {
  await mutateState(path, (state) => {
    state.shares = state.shares.filter((share) => share.url !== url);
  });
}

export async function findReusableShare(
  fingerprint: string,
  relayOrigin: string,
  path = defaultStatePath(),
): Promise<LocalShare | undefined> {
  const state = await loadState(path);
  for (let index = state.shares.length - 1; index >= 0; index -= 1) {
    const share = state.shares[index];
    if (
      share !== undefined &&
      share.fingerprint === fingerprint &&
      share.relayOrigin === relayOrigin &&
      Date.parse(share.expiresAt) > Date.now()
    ) {
      return share;
    }
  }
  return undefined;
}

export async function findShareByUrl(
  url: string,
  path = defaultStatePath(),
): Promise<LocalShare | undefined> {
  return (await loadState(path)).shares.find((share) => share.url === url);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isLocalShare(value: unknown): value is LocalShare {
  if (typeof value !== "object" || value === null) return false;
  const share = value as Record<string, unknown>;
  const pending = share.pendingUpload;
  return (
    [
      "fingerprint",
      "relayOrigin",
      "shareId",
      "url",
      "revokeCapability",
      "expiresAt",
    ].every((key) => typeof share[key] === "string") &&
    (pending === undefined ||
      (typeof pending === "object" &&
        pending !== null &&
        typeof (pending as Record<string, unknown>).uploadCapability ===
          "string" &&
        typeof (pending as Record<string, unknown>).ciphertextSha256 ===
          "string" &&
        typeof (pending as Record<string, unknown>).envelopeBase64 ===
          "string"))
  );
}

async function mutateState(
  path: string,
  mutate: (state: LocalState) => void,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const release = await acquireLock(`${path}.lock`);
  try {
    const state = await loadState(path);
    mutate(state);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, path);
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
      let age: number;
      try {
        age = Date.now() - (await stat(path)).mtimeMs;
      } catch (statError) {
        if (isNotFound(statError)) continue;
        throw statError;
      }
      if (age > 30_000) {
        await rm(path, { force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out acquiring AgentShare state lock: ${path}`);
}

function isLockContention(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    ["EEXIST", "EPERM", "EBUSY"].includes(String(error.code))
  );
}
