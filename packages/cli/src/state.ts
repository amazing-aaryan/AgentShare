import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type LocalShare = {
  fingerprint: string;
  relayOrigin: string;
  shareId: string;
  url: string;
  revokeCapability: string;
  expiresAt: string;
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
    return { version: 1, shares: parsed.shares as LocalShare[] };
  } catch (error) {
    if (isNotFound(error)) return { version: 1, shares: [] };
    throw error;
  }
}

export async function saveShare(
  share: LocalShare,
  path = defaultStatePath(),
): Promise<void> {
  const state = await loadState(path);
  state.shares = state.shares.filter(
    (item) =>
      !(
        item.fingerprint === share.fingerprint &&
        item.relayOrigin === share.relayOrigin
      ),
  );
  state.shares.push(share);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
}

export async function findReusableShare(
  fingerprint: string,
  relayOrigin: string,
  path = defaultStatePath(),
): Promise<LocalShare | undefined> {
  const state = await loadState(path);
  return state.shares.find(
    (share) =>
      share.fingerprint === fingerprint &&
      share.relayOrigin === relayOrigin &&
      Date.parse(share.expiresAt) > Date.now(),
  );
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
