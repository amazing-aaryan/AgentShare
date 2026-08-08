import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AcbManifest, SessionEvent } from "@agentshare/contracts";

type JsonObject = Record<string, unknown>;

export async function exportCurrentCodexSession(
  options: {
    threadId?: string;
    sessionsRoot?: string;
  } = {},
): Promise<AcbManifest> {
  const threadId = options.threadId ?? process.env.CODEX_THREAD_ID;
  if (threadId === undefined || !/^[A-Za-z0-9-]+$/u.test(threadId)) {
    throw new Error(
      "CODEX_THREAD_ID is unavailable; run from the Codex session being shared",
    );
  }
  const root = options.sessionsRoot ?? join(homedir(), ".codex", "sessions");
  const matches = (await findJsonl(root)).filter((path) =>
    basename(path).includes(threadId),
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      `Expected one Codex session for ${threadId}; found ${matches.length}`,
    );
  }
  return parseCodexSession(await readFile(matches[0], "utf8"), threadId);
}

export function parseCodexSession(
  jsonl: string,
  threadId = "codex-session",
): AcbManifest {
  const events: SessionEvent[] = [];
  let title = `Codex session ${threadId}`;
  for (const line of jsonl.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const item = parseObject(line);
    if (item?.type === "session_meta") {
      const payload = asObject(item.payload);
      const cwd = stringValue(payload?.cwd);
      if (cwd !== undefined) title = `Codex: ${basename(cwd)}`;
      continue;
    }
    if (item?.type !== "response_item") continue;
    const payload = asObject(item.payload);
    if (payload?.type !== "message") continue;
    const role =
      payload.role === "user"
        ? "user"
        : payload.role === "assistant"
          ? "assistant"
          : undefined;
    if (role === undefined) continue;
    const text = messageText(payload.content);
    if (text.length === 0) continue;
    events.push({
      sequence: events.length,
      role,
      kind: "message",
      text,
      sourceId: threadId,
    });
  }
  if (events.length === 0)
    throw new Error("Codex session contains no shareable messages");
  return {
    version: "acb-v1",
    title,
    sourceAgent: "codex",
    exportedAt: new Date().toISOString(),
    events,
    resources: [],
  };
}

function messageText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const object = asObject(part);
      return object?.type === "input_text" || object?.type === "output_text"
        ? (stringValue(object.text) ?? "")
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function findJsonl(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await findJsonl(path)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path);
  }
  return found;
}

function parseObject(line: string): JsonObject | undefined {
  try {
    return asObject(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
