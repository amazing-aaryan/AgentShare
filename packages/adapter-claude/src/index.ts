import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AcbManifest, SessionEvent } from "@agentshare/contracts";

type JsonObject = Record<string, unknown>;

export type ClaudeHostCapture = {
  sourceAgent: "claude";
  title: string;
  workspaceRoot: string;
  conversation: SessionEvent[];
};

export async function exportCurrentClaudeCapture(
  options: {
    sessionId?: string;
    projectsRoot?: string;
  } = {},
): Promise<ClaudeHostCapture> {
  const sessionId = options.sessionId ?? process.env.CLAUDE_SESSION_ID;
  if (sessionId === undefined || !/^[A-Za-z0-9-]+$/u.test(sessionId)) {
    throw new Error(
      "CLAUDE_SESSION_ID is unavailable; run from the Claude session being shared",
    );
  }
  const root = options.projectsRoot ?? join(homedir(), ".claude", "projects");
  const matches = (await findJsonl(root)).filter(
    (path) => basename(path, ".jsonl") === sessionId,
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      `Expected one Claude session for ${sessionId}; found ${matches.length}`,
    );
  }
  return parseClaudeCapture(await readFile(matches[0], "utf8"), sessionId);
}

export async function exportCurrentClaudeSession(
  options: {
    sessionId?: string;
    projectsRoot?: string;
  } = {},
): Promise<AcbManifest> {
  return captureToManifest(await exportCurrentClaudeCapture(options));
}

export function parseClaudeCapture(
  jsonl: string,
  sessionId = "claude-session",
): ClaudeHostCapture {
  const events: SessionEvent[] = [];
  let workspaceRoot: string | undefined;
  for (const line of jsonl.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const item = parseObject(line);
    if (item === undefined || item.isSidechain === true) continue;
    const cwd = stringValue(item.cwd);
    if (cwd !== undefined) workspaceRoot = cwd;
    if (item.type !== "user" && item.type !== "assistant") continue;
    const message = asObject(item.message);
    const text = messageText(message?.content);
    if (text.length === 0) continue;
    events.push({
      sequence: events.length,
      role: item.type,
      kind: "message",
      text,
      sourceId: sessionId,
    });
  }
  if (events.length === 0)
    throw new Error("Claude session contains no shareable messages");
  if (workspaceRoot === undefined)
    throw new Error("Claude session does not contain a workspace root");
  return {
    sourceAgent: "claude",
    title: `Claude: ${basename(workspaceRoot)}`,
    workspaceRoot,
    conversation: events,
  };
}

export function parseClaudeSession(
  jsonl: string,
  sessionId = "claude-session",
): AcbManifest {
  return captureToManifest(parseClaudeCapture(jsonl, sessionId));
}

function captureToManifest(capture: ClaudeHostCapture): AcbManifest {
  return {
    version: "acb-v1",
    title: capture.title,
    sourceAgent: "claude",
    exportedAt: new Date().toISOString(),
    events: capture.conversation,
    resources: [],
  };
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const object = asObject(part);
      return object?.type === "text" ? (stringValue(object.text) ?? "") : "";
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
