import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportCurrentCodexCapture,
  parseCodexCapture,
  parseCodexSession,
} from "./index.js";

const input = [
  JSON.stringify({
    type: "session_meta",
    payload: { id: "synthetic-id", cwd: "C:/synthetic/repo" },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Question" }],
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Answer" }],
    },
  }),
].join("\n");

describe("Codex adapter", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("extracts canonical user and assistant messages", () => {
    const result = parseCodexSession(input, "synthetic-id");
    expect(result.sourceAgent).toBe("codex");
    expect(result.events.map((event) => event.text)).toEqual([
      "Question",
      "Answer",
    ]);
  });

  it("captures the session workspace root for v2 without changing v1 output", () => {
    const capture = parseCodexCapture(input, "synthetic-id");
    expect(capture.workspaceRoot).toBe("C:/synthetic/repo");
    expect(capture.conversation.map((event) => event.text)).toEqual([
      "Question",
      "Answer",
    ]);
    expect(parseCodexSession(input, "synthetic-id").resources).toEqual([]);
  });

  it("rejects missing, conflicting, duplicate, and relative-root session metadata", () => {
    for (const content of [
      input.replace('"id":"synthetic-id",', ""),
      input.replace('"synthetic-id"', '"other-id"'),
      input + "\n" + (input.split("\n")[0] ?? ""),
      input.replace("C:/synthetic/repo", "relative/repo"),
    ])
      expect(() => parseCodexCapture(content, "synthetic-id")).toThrow(
        /metadata/,
      );
  });

  it("honors configured CODEX_HOME, exact identity and explicit relocation without rewriting transcripts", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentshare-codex-context-"));
    try {
      const sessions = join(root, "configured", "sessions");
      const original = join(root, "original");
      const relocated = join(root, "relocated");
      await Promise.all([
        mkdir(sessions, { recursive: true }),
        mkdir(original),
        mkdir(relocated),
      ]);
      const content = input.replace(
        "C:/synthetic/repo",
        original.replaceAll("\\", "\\\\"),
      );
      const path = join(sessions, "rollout-synthetic-id.jsonl");
      await writeFile(path, content);
      vi.stubEnv("CODEX_HOME", join(root, "configured"));
      vi.stubEnv("CODEX_THREAD_ID", "synthetic-id");
      const recorded = await exportCurrentCodexCapture();
      expect(recorded.workspaceRoot).toBe(original);
      expect(recorded.sessionRef).toBe("synthetic-id");
      const moved = await exportCurrentCodexCapture({
        sessionId: "synthetic-id",
        projectRoot: relocated,
      });
      expect(moved.recordedRoot).toBe(original);
      expect(moved.workspaceRoot).toBe(relocated);
      expect(moved.conversation).toEqual(recorded.conversation);
      expect(await readFile(path, "utf8")).toBe(content);
      await rm(original, { recursive: true });
      await expect(
        exportCurrentCodexCapture({ validateProjectRoot: true }),
      ).rejects.toThrow("inaccessible");
      expect((await exportCurrentCodexCapture()).recordedRoot).toBe(original);
      expect(
        (await exportCurrentCodexCapture({ projectRoot: relocated }))
          .workspaceRoot,
      ).toBe(relocated);
      await writeFile(join(sessions, "duplicate-synthetic-id.jsonl"), content);
      await expect(exportCurrentCodexCapture()).rejects.toThrow("found 2");
      await rm(join(sessions, "duplicate-synthetic-id.jsonl"));
      vi.stubEnv("CODEX_THREAD_ID", "id");
      await expect(exportCurrentCodexCapture()).rejects.toThrow("metadata");
      vi.stubEnv("CODEX_THREAD_ID", "missing-id");
      await expect(exportCurrentCodexCapture()).rejects.toThrow("found 0");
      vi.stubEnv("CODEX_THREAD_ID", "");
      await expect(exportCurrentCodexCapture()).rejects.toThrow("session-id");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
