# Cloudflare deployment

The public relay uses one SQLite-backed Durable Object per share plus one global
quota object. Ciphertext streams into 1.5 MB chunks, is capped at 50 MiB, and is
deleted by an expiry alarm after at most three days. Expired and revoked share
IDs retain compact tombstones. Cloudflare rate-limit bindings protect create and
upload routes.

```powershell
npm ci
npx wrangler login
npx wrangler deploy --config apps/edge-relay/wrangler.jsonc
```

Set the returned Workers URL for creators:

```powershell
$env:AGENTSHARE_RELAY = "https://agentshare-relay.carnation-vermicelli.workers.dev"
agentshare share --current --source codex
```

Run a create/upload/download/revoke smoke test before announcing the endpoint.
Cloudflare stores only ciphertext and SHA-256 capability digests. Encryption
keys remain in URL fragments and are never sent to the relay by browsers.

Deployments require the `ShareObject` v1 and `RelayControl` v2 Durable Object
migrations in `wrangler.jsonc`. Never remove or renumber a published migration.
