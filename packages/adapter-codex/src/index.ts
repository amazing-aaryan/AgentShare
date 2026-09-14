import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, win32 } from "node:path";
import type { AcbManifest, SessionEvent } from "@agentshare/contracts";

type JsonObject = Record<string, unknown>;

export type CodexHostCapture = {
  sourceAgent: "codex";
  title: string;
  workspaceRoot: string;
  conversation: SessionEvent[];
  sessionRef?: string;
  recordedRoot?: string;
};

export type CodexCaptureOptions = {
  threadId?: string;
  sessionId?: string;
  sessionsRoot?: string;
  codexHome?: string;
  projectRoot?: string;
  validateProjectRoot?: boolean;
};

export async function exportCurrentCodexCapture(
  options: CodexCaptureOptions = {},
): Promise<CodexHostCapture> {
  if (
    options.sessionId !== undefined &&
    options.threadId !== undefined &&
    options.sessionId !== options.threadId
  ) {
    throw new Error("Conflicting explicit Codex session identities");
  }
  const threadId =
    options.sessionId ?? options.threadId ?? process.env.CODEX_THREAD_ID;
  if (threadId === undefined || !/^[A-Za-z0-9-]+$/u.test(threadId)) {
    throw new Error(
      "CODEX_THREAD_ID is unavailable; supply --session-id or run from the exact Codex session being shared",
    );
  }
  const codexHome =
    options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const root = options.sessionsRoot ?? join(codexHome, "sessions");
  if (!isAbsolute(root))
    throw new Error("Codex session storage must be an absolute path");
  const matches = (await findJsonl(root)).filter(
    (path) =>
      basename(path) === `${threadId}.jsonl` ||
      basename(path).endsWith(`-${threadId}.jsonl`),
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      `Expected one Codex session for ${threadId}; found ${matches.length}`,
    );
  }
  const capture = parseCodexCapture(
    await readFile(matches[0], "utf8"),
    threadId,
  );
  // Metadata-only callers (creator session resolution) must be able to report
  // a missing recorded root and request relocation before preparing workspace.
  if (options.projectRoot === undefined && options.validateProjectRoot !== true)
    return capture;
  const selectedRoot =
    options.projectRoot ?? capture.recordedRoot ?? capture.workspaceRoot;
  if (!isAbsolute(selectedRoot))
    throw new Error("Project root must be an absolute path");
  try {
    if (!(await stat(selectedRoot)).isDirectory())
      throw new Error("Not a directory");
    await access(selectedRoot, constants.R_OK);
    capture.workspaceRoot = await realpath(selectedRoot);
  } catch {
    throw new Error(
      "Selected project root is inaccessible; supply an explicit --project-root relocation and review it",
    );
  }
  return capture;
}

export async function exportCurrentCodexSession(
  options: CodexCaptureOptions = {},
): Promise<AcbManifest> {
  return captureToManifest(await exportCurrentCodexCapture(options));
}

export function parseCodexCapture(
  jsonl: string,
  threadId?: string,
): CodexHostCapture {
  const events: SessionEvent[] = [];
  let workspaceRoot: string | undefined;
  let sessionId: string | undefined;
  let metadataCount = 0;
  for (const line of jsonl.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const item = parseObject(line);
    if (item?.type === "session_meta") {
      metadataCount += 1;
      const payload = asObject(item.payload);
      const cwd = stringValue(payload?.cwd);
      const id = stringValue(payload?.id);
      if (
        metadataCount !== 1 ||
        id === undefined ||
        !/^[A-Za-z0-9-]+$/u.test(id) ||
        (threadId !== undefined && id !== threadId) ||
        cwd === undefined ||
        (!isAbsolute(cwd) && !win32.isAbsolute(cwd))
      ) {
        throw new Error(
          "Codex session metadata identity/root mismatch or ambiguity",
        );
      }
      workspaceRoot = cwd;
      sessionId = id;
      continue;
    }
    if (item?.type !== "response_item") continue;
    if (sessionId === undefined)
      throw new Error("Codex session metadata must precede conversation");
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
      sourceId: threadId ?? sessionId,
    });
  }
  if (events.length === 0)
    throw new Error("Codex session contains no shareable messages");
  if (workspaceRoot === undefined || sessionId === undefined)
    throw new Error(
      "Codex session does not contain valid session metadata and workspace root",
    );
  return {
    sourceAgent: "codex",
    title: `Codex: ${basename(workspaceRoot)}`,
    workspaceRoot,
    conversation: events,
    sessionRef: sessionId,
    recordedRoot: workspaceRoot,
  };
}

export function parseCodexSession(
  jsonl: string,
  threadId?: string,
): AcbManifest {
  return captureToManifest(parseCodexCapture(jsonl, threadId));
}

function captureToManifest(capture: CodexHostCapture): AcbManifest {
  return {
    version: "acb-v1",
    title: capture.title,
    sourceAgent: "codex",
    exportedAt: new Date().toISOString(),
    events: capture.conversation,
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
