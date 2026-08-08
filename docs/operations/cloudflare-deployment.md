# Cloudflare deployment

The public relay uses one SQLite-backed Durable Object per share. Ciphertext is
stored in 1.5 MB chunks, capped at 50 MiB, and deleted by an expiry alarm after
at most three days.

```powershell
npm ci
npx wrangler login
npx wrangler deploy --config apps/edge-relay/wrangler.jsonc
```

Set the returned Workers URL for creators:

```powershell
$env:AGENTSHARE_RELAY = "https://agentshare-relay.<account>.workers.dev"
agentshare share --current --source codex
```

Run a create/upload/download/revoke smoke test before announcing the endpoint.
Cloudflare stores only ciphertext and SHA-256 capability digests. Encryption
keys remain in URL fragments and are never sent to the relay by browsers.
