import { createHash, randomBytes } from "node:crypto";
import { unstable_dev } from "wrangler";

const capability = (bytes = 32) => randomBytes(bytes).toString("base64url");
const digest = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const worker = await unstable_dev("apps/edge-relay/src/index.ts", {
  config: "apps/edge-relay/wrangler.jsonc",
  local: true,
  logLevel: "error",
  experimental: {
    disableExperimentalWarning: true,
    disableDevRegistry: true,
    watch: false,
  },
});

try {
  const shareId = capability(18);
  const upload = capability();
  const read = capability();
  const revoke = capability();
  const created = await worker.fetch("/v1/shares", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "127.0.0.1",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      shareId,
      requestedTtlSeconds: 60,
      uploadTokenDigest: digest(upload),
      readTokenDigest: digest(read),
      revokeTokenDigest: digest(revoke),
    }),
  });
  if (created.status !== 201) {
    throw new Error(
      `edge create failed: ${created.status} ${await created.text()}`,
    );
  }

  const blob = randomBytes(3_100_000);
  const uploaded = await worker.fetch(`/v1/shares/${shareId}/blob`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${upload}`,
      "cf-connecting-ip": "127.0.0.1",
      "content-length": String(blob.byteLength),
      "x-agentshare-sha256": createHash("sha256").update(blob).digest("hex"),
    },
    body: blob,
  });
  if (uploaded.status !== 200) {
    throw new Error(
      `edge upload failed: ${uploaded.status} ${await uploaded.text()}`,
    );
  }

  const downloaded = await worker.fetch(`/v1/shares/${shareId}/blob`, {
    headers: { authorization: `Bearer ${read}` },
  });
  const received = Buffer.from(await downloaded.arrayBuffer());
  if (downloaded.status !== 200 || !received.equals(blob)) {
    throw new Error("edge download did not preserve ciphertext");
  }

  const revokeRequest = () =>
    worker.fetch(`/v1/shares/${shareId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${revoke}` },
    });
  if ((await revokeRequest()).status !== 200)
    throw new Error("edge revoke failed");
  if ((await revokeRequest()).status !== 200)
    throw new Error("edge revoke retry was not idempotent");
  if (
    (
      await worker.fetch(`/v1/shares/${shareId}/blob`, {
        headers: { authorization: `Bearer ${read}` },
      })
    ).status !== 410
  ) {
    throw new Error("edge revoked read did not fail closed");
  }

  process.stdout.write("Edge runtime handoff passed\n");
} finally {
  await worker.stop();
}
