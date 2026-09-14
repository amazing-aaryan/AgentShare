import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { link, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ensurePrivateDirectory,
  securePrivatePath,
} from "@agentshare/integrations";
export {
  ensurePrivateDirectory,
  securePrivatePath,
} from "@agentshare/integrations";

async function localKey(root: string): Promise<Buffer> {
  await ensurePrivateDirectory(root);
  const path = join(root, "local.key");
  const temporary = join(root, `key-${randomUUID()}.tmp`);
  await writeFile(temporary, randomBytes(32), { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  } finally {
    await rm(temporary);
  }
  await securePrivatePath(path);
  const key = await readFile(path);
  if (key.length !== 32)
    throw new Error("Invalid AgentShare local storage key");
  return key;
}

export async function writePrivateJson(
  root: string,
  name: string,
  value: unknown,
): Promise<void> {
  assertName(name);
  const key = await localKey(root);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`agentshare-local-v1:${name}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const bytes = Buffer.concat([
    Buffer.from([1]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
  const temporary = join(root, `${name}.${randomUUID()}.tmp`);
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, join(root, name));
}

export async function readPrivateJson(
  root: string,
  name: string,
): Promise<unknown> {
  assertName(name);
  await ensurePrivateDirectory(root);
  await securePrivatePath(join(root, name));
  const bytes = await readFile(join(root, name));
  if (bytes[0] !== 1 || bytes.length < 30)
    throw new Error("Invalid private AgentShare record");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await localKey(root),
    bytes.subarray(1, 13),
  );
  decipher.setAAD(Buffer.from(`agentshare-local-v1:${name}`));
  decipher.setAuthTag(bytes.subarray(13, 29));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(29)),
      decipher.final(),
    ]).toString("utf8"),
  );
}

function assertName(name: string): void {
  if (!/^[a-zA-Z0-9_-]+\.enc$/u.test(name))
    throw new Error("Invalid private record name");
}
