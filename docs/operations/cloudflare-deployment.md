# Cloudflare deployment

AgentShare v0.1.11 uses two public Workers with different responsibilities:

- `agentshare-relay` stores ciphertext and capability digests in Durable
  Objects.
- `agentshare-handoff` serves the trusted static browser page that can read the
  capability fragment. It has no ciphertext, Durable Object, or quota bindings.

The relay uses one SQLite-backed Durable Object per share plus one global quota
object. Ciphertext streams into 1.5 MB chunks, is capped at 50 MiB, and is
deleted by an expiry alarm after at most three days. Expired and revoked share
IDs retain compact tombstones. Cloudflare rate-limit bindings protect create and
upload routes.

## Pre-deployment checks

From the exact release candidate commit:

```powershell
npm ci
npm run format:check
npm run lint
npm run build
npm run test:coverage
npm run test:package
npm run test:edge-runtime
npx wrangler deploy --dry-run --config apps/edge-relay/wrangler.jsonc
npx wrangler deploy --dry-run --config apps/handoff/wrangler.jsonc
npm audit --audit-level=high
```

Do not publish the v0.1.11 creator package until the independent handoff Worker
is live. The released CLI generates handoff-origin links immediately, so
publishing first could create links whose browser endpoint returns 404.

## Deployment order

Authenticate Wrangler, then deploy the handoff Worker first:

```powershell
npx wrangler login
npx wrangler deploy --config apps/handoff/wrangler.jsonc
```

Confirm the returned URL is
`https://agentshare-handoff.carnation-vermicelli.workers.dev`. Before moving on,
verify a `/s/<share-id>?relay=<encoded-relay-origin>` request reaches the Worker
and returns the expected `no-store`, `no-referrer`, frame-denial, nosniff, and
relay-scoped CSP headers. A real share is required for the complete metadata and
copy-unlock browser flow.

The existing production relay does not need redeployment when its code and
bindings are unchanged. If relay code is part of the release, deploy it only
with the published Durable Object migration history intact:

```powershell
npx wrangler deploy --config apps/edge-relay/wrangler.jsonc
```

Deployments require the `ShareObject` v1 and `RelayControl` v2 Durable Object
migrations in `apps/edge-relay/wrangler.jsonc`. Never remove, rename, or
renumber a published migration.

## Strict live release gate

After the required Workers are live, run the strict gate from the release
candidate with authenticated reviewed Codex and Claude installations:

```powershell
$env:AGENTSHARE_E2E_RELAY="https://agentshare-relay.carnation-vermicelli.workers.dev"
$env:AGENTSHARE_E2E_HANDOFF="https://agentshare-handoff.carnation-vermicelli.workers.dev"
npm run test:release
```

The gate fails unless relay and handoff are distinct HTTPS origins. It exercises
the real handoff page and security headers, relay CORS, production
create/upload/download/revoke/expiry and replay semantics, and both real target
agents' filesystem/network isolation. A partial or one-agent diagnostic is not a
release pass.

## Package publication and public verification

Only after the live split-origin gate passes should the immutable v0.1.11 CLI
asset be published. Record its byte size and SHA-256 digest. Then verify an
anonymous download against the recorded digest and perform a fresh isolated
installation from the release asset. The handoff page must display a command
pinned to that exact immutable asset, and a disposable live share must complete
the browser-to-hidden-prompt recipient flow.

Do not announce the release until these checks and the exact Worker deployment
versions are recorded in `docs/releases/v0.1.11-release-verification.md`.

## Rollback

The primary rollback target for v0.1.11 is the published v0.1.10 package plus
the previous relay deployment. Existing v0.1.9 links continue to use the legacy
relay-origin page and do not depend on the new handoff Worker.

If the handoff Worker fails before v0.1.11 package publication, roll it back or
leave v0.1.10 as the public release. If a defect appears after v0.1.11
publication, stop promoting v0.1.11, preserve relay Durable Object storage, roll
back the affected Worker deployment, and direct users to the recorded safe
package version while the incident is investigated. Do not delete or recreate
the relay Durable Object namespace as part of rollback.

Cloudflare stores only ciphertext and SHA-256 capability digests. New-format
browser requests send the relay only the read capability needed for metadata
validation; the encryption key remains in the URL fragment on the trusted
handoff page.
