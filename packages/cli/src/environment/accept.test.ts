import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  decryptEnvironmentObject,
  encryptEnvironmentObject,
  parseEnvironmentUrl,
} from "@agentshare/acb";
import { environmentManifestSchema } from "@agentshare/contracts";
import { createRelayHandler, InMemoryRelayStore } from "@agentshare/relay";
import { EnvironmentRelayClient } from "./relay-client.js";
import { createEnvironmentFromCapture } from "./publication.js";
import {
  acceptEnvironmentLink,
  readAttachedFile,
  searchAttachedEnvironment,
} from "./accept.js";

async function creatorFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentshare-accept-creator-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "auth.ts"),
    "export function authenticate(token: string) { return token === 'trusted'; }\n",
  );
  return root;
}

describe("recipient environment attachment", () => {
  it("accepts one link, caches ciphertext, and supports safe file search/read", async () => {
    const now = new Date();
    const handler = createRelayHandler(new InMemoryRelayStore(), {
      now: () => now,
    });
    const fetchImpl: typeof fetch = (input, init) =>
      handler(new Request(input, init));
    const client = new EnvironmentRelayClient(
      "http://127.0.0.1:8787",
      fetchImpl,
    );
    const creatorState = join(
      await mkdtemp(join(tmpdir(), "agentshare-creator-state-")),
      "state-v2.json",
    );
    const creatorRoot = await creatorFixture();
    const readable = [
      { path: "config.yaml", text: "\uFEFFdeployment: yamlmarker\r\n" },
      { path: "config.toml", text: 'deployment = "tomlmarker"\r\n' },
      { path: "config.json", text: '{"deployment":"jsonmarker"}\r\n' },
    ];
    const unreadable = [
      {
        path: "invalid.txt",
        bytes: Buffer.concat([
          Buffer.from("invalidmarker "),
          Buffer.from([0xff]),
        ]),
      },
      { path: "nul.txt", bytes: Buffer.from("nulmarker\0") },
      { path: "utf16le.txt", bytes: Buffer.from("utf16lemarker", "utf16le") },
      {
        path: "utf16be.txt",
        bytes: Buffer.from("utf16bemarker", "utf16le").swap16(),
      },
      { path: "charset.txt", bytes: Buffer.from("charsetmarker") },
    ];
    for (const file of readable)
      await writeFile(join(creatorRoot, file.path), file.text);
    for (const file of unreadable)
      await writeFile(join(creatorRoot, file.path), file.bytes);
    const shared = await createEnvironmentFromCapture(
      {
        sourceAgent: "codex",
        title: "Auth project",
        workspaceRoot: creatorRoot,
        conversation: [
          {
            sequence: 0,
            role: "user",
            kind: "message",
            text: "Authentication uses a trusted token.",
            sourceId: "thread",
          },
        ],
      },
      {
        client,
        statePath: creatorState,
        ttlSeconds: 86400,
        proposalsEnabled: true,
        includeConversation: true,
        includeWorkspace: true,
        now: () => now,
        workspaceOptions: { preferGit: false },
      },
    );

    // Exercise the recipient's own classifier, including an older sender that
    // labels non-UTF-8 bytes as text. All traffic stays in the in-memory relay.
    const parsed = parseEnvironmentUrl(shared.url);
    const metadata = await client.metadata(
      parsed.environmentId,
      parsed.readCapability,
    );
    const revision = metadata.currentRevision;
    if (revision === null) throw new Error("Missing fixture revision");
    const context = {
      environmentId: parsed.environmentId,
      revisionId: revision.revisionId,
      kind: "manifest" as const,
      objectId: `manifest_${revision.revisionId}`,
    };
    const encrypted = await client.downloadManifest(
      parsed.environmentId,
      revision.revisionId,
      parsed.readCapability,
    );
    const manifest = environmentManifestSchema.parse(
      JSON.parse(
        Buffer.from(
          decryptEnvironmentObject(
            encrypted,
            parsed.environmentMasterKey,
            context,
          ),
        ).toString("utf8"),
      ) as unknown,
    );
    for (const file of manifest.workspace.files) {
      if (unreadable.some((entry) => entry.path === file.path)) {
        file.mediaType =
          file.path === "charset.txt"
            ? "text/plain; charset=utf-16"
            : "text/plain; charset=utf-8";
      } else {
        file.mediaType = `${file.mediaType.toUpperCase()}; charset="UTF-8"`;
      }
    }
    const replacement = encryptEnvironmentObject(
      Buffer.from(JSON.stringify(manifest)),
      parsed.environmentMasterKey,
      context,
    );
    vi.spyOn(client, "metadata").mockResolvedValue({
      ...metadata,
      currentRevision: {
        ...revision,
        manifest: {
          ciphertextSha256: replacement.ciphertextSha256,
          ciphertextBytes: replacement.envelope.byteLength,
        },
      },
    });
    vi.spyOn(client, "downloadManifest").mockResolvedValue(
      replacement.envelope,
    );

    const recipientState = join(
      await mkdtemp(join(tmpdir(), "agentshare-recipient-state-")),
      "state-v2.json",
    );
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentshare-cache-"));
    const attached = await acceptEnvironmentLink(shared.url, {
      client,
      statePath: recipientState,
      cacheRoot,
      now: () => now,
    });

    expect(attached.title).toBe("Auth project");
    expect(attached.files).toBe(1 + readable.length + unreadable.length);
    expect(attached.conversationEvents).toBe(1);
    const hits = await searchAttachedEnvironment(
      attached.environmentId,
      "authenticate trusted token",
      { statePath: recipientState, cacheRoot },
    );
    expect(hits.some((hit) => hit.source === "src/auth.ts")).toBe(true);
    expect(
      await readAttachedFile(attached.environmentId, "src/auth.ts", {
        statePath: recipientState,
        cacheRoot,
      }),
    ).toContain("authenticate");
    const readOptions = { statePath: recipientState, cacheRoot };
    for (const file of readable) {
      expect(
        await readAttachedFile(attached.environmentId, file.path, readOptions),
      ).toBe(file.text);
      const marker = /\w+marker/u.exec(file.text)?.[0] ?? "";
      const fileHits = await searchAttachedEnvironment(
        attached.environmentId,
        marker,
        readOptions,
      );
      expect(fileHits.some((hit) => hit.source === file.path)).toBe(true);
    }
    for (const file of unreadable) {
      await expect(
        readAttachedFile(attached.environmentId, file.path, readOptions),
      ).rejects.toThrow(`Shared file is not text-readable: ${file.path}`);
      const fileHits = await searchAttachedEnvironment(
        attached.environmentId,
        `${file.path.split(".")[0]}marker`,
        readOptions,
      );
      expect(fileHits.some((hit) => hit.source === file.path)).toBe(false);
    }
    const secret = `sk-${"x".repeat(24)}`;
    await expect(
      readAttachedFile(
        attached.environmentId,
        `${secret}.txt#private-fragment`,
        readOptions,
      ),
    ).rejects.toThrow("[REDACTED:openai-api-key].txt[REDACTED:url-suffix]");
  });
});
