import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capabilityDigest,
  parseShareUrl,
  randomCapability,
  sha256Hex,
} from "@agentshare/acb";
import {
  createRelayHandler,
  InMemoryRelayStore,
  startNodeServer,
} from "@agentshare/relay";
import { openShare, shareCommand } from "./commands.js";
import { RelayClient } from "./relay-client.js";
import { retrieveEvidence } from "./retrieval.js";
import { loadState } from "./state.js";

const configuredOrigin = process.env.AGENTSHARE_E2E_RELAY;

describe("complete AgentShare handoff", () => {
  it("publishes, opens, queries, and revokes one encrypted context bundle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentshare-e2e-"));
    const inputPath = join(directory, "session.md");
    const statePath = join(directory, "state.json");
    await writeFile(
      inputPath,
      "The deterministic parser uses canonical key ordering. Never use insertion order.",
      "utf8",
    );

    const server =
      configuredOrigin === undefined
        ? startNodeServer(createRelayHandler(new InMemoryRelayStore()), 0)
        : undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.once("listening", resolve));
    }

    try {
      const address = server?.address();
      const origin =
        configuredOrigin ??
        (address !== null &&
        address !== undefined &&
        typeof address !== "string"
          ? `http://127.0.0.1:${address.port}`
          : undefined);
      if (origin === undefined) throw new Error("Missing E2E relay address");
      const url = await shareCommand({
        inputPath,
        relayOrigin: origin,
        handoffOrigin: origin,
        ttlSeconds: 60,
        sourceAgent: "generic",
        assumeApproved: true,
        forceNew: true,
        statePath,
      });

      const page = await fetch(url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("agentshare open --target codex");

      const opened = await openShare(url);
      expect(opened.manifest.events[0]?.text).toContain(
        "canonical key ordering",
      );
      expect(retrieveEvidence(opened.manifest, "canonical ordering")).toEqual([
        expect.objectContaining({ citation: "session.md#event-0", score: 2 }),
      ]);

      const [saved] = (await loadState(statePath)).shares;
      if (saved === undefined) throw new Error("Share state was not saved");
      const parsed = parseShareUrl(url);
      await new RelayClient(origin).revoke(
        parsed.shareId,
        saved.revokeCapability,
      );

      await expect(openShare(url)).rejects.toMatchObject({ status: 410 });

      const replacement = await shareCommand({
        inputPath,
        relayOrigin: origin,
        handoffOrigin: origin,
        ttlSeconds: 60,
        sourceAgent: "generic",
        assumeApproved: true,
        statePath,
      });
      expect(replacement).not.toBe(url);
      await expect(openShare(replacement)).resolves.toMatchObject({
        manifest: { title: "session.md" },
      });
    } finally {
      if (server !== undefined) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(configuredOrigin === undefined)(
    "enforces production replay, expiry, and concurrent upload semantics",
    async () => {
      if (configuredOrigin === undefined) return;
      const client = new RelayClient(configuredOrigin);
      const shareId = randomCapability(18);
      const upload = randomCapability();
      const read = randomCapability();
      const revoke = randomCapability();
      await client.create({
        shareId,
        requestedTtlSeconds: 60,
        uploadTokenDigest: capabilityDigest(upload),
        readTokenDigest: capabilityDigest(read),
        revokeTokenDigest: capabilityDigest(revoke),
      });
      const envelope = Buffer.from("synthetic encrypted envelope", "utf8");
      const uploadRequest = {
        shareId,
        uploadCapability: upload,
        ciphertextSha256: sha256Hex(envelope),
        envelope,
      };

      await Promise.all([
        client.upload(uploadRequest),
        client.upload(uploadRequest),
      ]);
      await expect(
        client.upload({
          ...uploadRequest,
          ciphertextSha256: sha256Hex(Buffer.from("different", "utf8")),
          envelope: Buffer.from("different", "utf8"),
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(client.download(shareId, read)).resolves.toEqual(envelope);
      await client.revoke(shareId, revoke);

      const expiringId = randomCapability(18);
      const expiringUpload = randomCapability();
      const expiringRead = randomCapability();
      const expiringRevoke = randomCapability();
      const expiringRequest = {
        shareId: expiringId,
        requestedTtlSeconds: 1,
        uploadTokenDigest: capabilityDigest(expiringUpload),
        readTokenDigest: capabilityDigest(expiringRead),
        revokeTokenDigest: capabilityDigest(expiringRevoke),
      };
      await client.create(expiringRequest);
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      await expect(
        client.metadata(expiringId, expiringRead),
      ).rejects.toMatchObject({ status: 410 });
      await expect(client.create(expiringRequest)).rejects.toMatchObject({
        status: 409,
      });
    },
    30_000,
  );
});
