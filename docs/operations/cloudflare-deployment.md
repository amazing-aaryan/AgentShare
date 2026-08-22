# Cloudflare Deployment

This runbook operates the **official free public transport** for AgentShare. The
public deployment is a convenience implementation of the open protocol, not an
account, workspace, billing, or organization control plane. Compatible
self-hosted deployments are part of the normal AgentShare model; see
[`../VISION.md`](../VISION.md), the
[Blind Relay Protocol](../protocol/relay-v1.md), and the
[Environment v2 Protocol](../protocol/environment-v2.md).

The v0.2.0 candidate uses two public Workers with different responsibilities:

- `agentshare-relay` stores ciphertext and capability digests in Durable
  Objects. It serves both legacy v1 shares and v2 environments.
- `agentshare-handoff` serves the trusted static `/s/` and `/e/` browser pages.
  It has no ciphertext, Durable Object, user-account, or quota-storage bindings.

The relay uses SQLite-backed Durable Objects for shares, environments, control,
and query state. Ciphertext is bounded by the public-service size and lifetime
limits and is deleted on expiry or revocation. Cloudflare rate-limit bindings
protect create and upload routes.

Public limits exist to keep a free shared service operable. They are deployment
policy, not a paid-tier boundary and not requirements for every compatible relay
implementation.

## Data and Trust Boundary

The official deployment must preserve these properties:

- no AgentShare account or organization database is required for sharing;
- the relay stores encrypted content, not conversation or workspace plaintext;
- the relay does not receive environment master keys;
- the handoff service does not persist share or environment ciphertext;
- the complete capability link remains the recipient authorization primitive;
- no analytics or third-party scripts are added to the handoff page;
- deployment changes must not create a hidden server-side plaintext dependency.

Normal Cloudflare infrastructure can still observe ordinary network and
transport metadata. The blind-relay claim is about content cryptography, not
network anonymity.

## Pre-deployment Checks

From the exact release-candidate commit:

```powershell
npm ci
node scripts/check-repository-hygiene.mjs
npm run format:check
npm run lint
npm run build
npm run test:coverage
npm run test:conformance
npm run test:package
npm run test:edge-runtime
npx wrangler deploy --dry-run --config apps/edge-relay/wrangler.jsonc
npx wrangler deploy --dry-run --config apps/handoff/wrangler.jsonc
npm audit --audit-level=high
```

The same commit must also pass the GitHub Actions matrix on Ubuntu, macOS, and
Windows with Node.js 22 and 24.

The v0.2.0 handoff Worker pins the immutable
`agentshare-0.2.0.tgz` GitHub-release asset. Stage that exact asset before the
handoff deployment so the browser command cannot point at a missing package.
Keep the GitHub release marked as a prerelease until the strict live gate passes;
the AgentShare updater ignores prereleases.

Record the staged asset byte size and SHA-256 before deployment. Do not replace
or mutate the asset after the Worker has been verified against it.

## Deployment Order

Authenticate Wrangler, then deploy the relay with the complete published Durable
Object migration history intact:

```powershell
npx wrangler login
npx wrangler deploy --config apps/edge-relay/wrangler.jsonc
```

The required migration sequence is:

- `v1`: `ShareObject`
- `v2`: `RelayControl`
- `v3`: `QueryObject`
- `v4`: `EnvironmentObject`

Never remove, rename, reuse, or renumber a published migration tag.

Next deploy the independent handoff Worker:

```powershell
npx wrangler deploy --config apps/handoff/wrangler.jsonc
```

For the official deployment, confirm the returned origins are:

```text
https://agentshare-relay.carnation-vermicelli.workers.dev
https://agentshare-handoff.carnation-vermicelli.workers.dev
```

Before running the full release gate, verify both handoff surfaces:

- `/s/<share-id>?relay=<encoded-relay-origin>` returns the legacy v1 handoff
  page with `no-store`, `no-referrer`, frame denial, nosniff, and relay-scoped
  CSP behavior;
- `/e/<environment-id>?relay=<encoded-relay-origin>` returns the v2 environment
  page without receiving capability-fragment secrets;
- `/e/<environment-id>/bootstrap.json?relay=<encoded-relay-origin>` returns the
  expected v0.2 bootstrap document.

A real share or environment is required for complete end-to-end capability and
ciphertext verification.

## Strict Live Release Gate

After both Workers and the staged immutable package are live, run the strict gate
from the release candidate with authenticated, reviewed Codex and Claude
installations:

```powershell
$env:AGENTSHARE_E2E_RELAY="https://agentshare-relay.carnation-vermicelli.workers.dev"
$env:AGENTSHARE_E2E_HANDOFF="https://agentshare-handoff.carnation-vermicelli.workers.dev"
npm run test:release
```

The gate fails unless relay and handoff are distinct HTTPS origins. It exercises
the real handoff page and security headers, relay CORS and lifecycle semantics,
and both real target agents' filesystem and network isolation. V2 environment
release evidence must also cover bootstrap, encrypted revision retrieval, and
the exact recipient isolation contract used by the candidate. A partial or
one-agent diagnostic is not a release pass.

AgentShare's agent-agnostic direction does not weaken this rule. Each new target
agent requires an equivalent exact-version isolation review before public
support is claimed.

## Promote the Release

Only after the strict live gate succeeds should the staged v0.2.0 GitHub release
be promoted from prerelease to stable. Verify an anonymous download against the
recorded byte size and SHA-256 and perform a fresh isolated installation from the
same immutable asset.

The handoff page must display a command pinned to that exact asset. Verify one
disposable v1 share and one disposable v2 environment through the real public
origins before announcing the stable release.

Record the exact commit, package digest, Worker deployment versions, supported
Codex/Claude versions, and live-gate evidence under `docs/releases/`.

## Rollback

A rollback must preserve Durable Object storage and migration history. Do not
delete or recreate the relay namespace to undo an application deployment.

If a defect appears before v0.2.0 is promoted to stable, keep the release marked
as a prerelease, roll back the affected Worker code, and leave the current stable
package as the recommended version. If a defect appears after promotion, stop
promoting the affected release, roll back the Worker code where safe, and direct
users to the recorded safe package version while the incident is investigated.

Existing v1 shares remain governed by their original protocol and capability
semantics. Rollback changes must not silently reinterpret stored ciphertext or
published Durable Object state.

## Self-hosting

The official Cloudflare deployment must not become the only viable way to use
the protocol. A self-hosted creator can configure the ciphertext relay and the
trusted handoff origin independently:

```powershell
agentshare share --current --source codex --relay https://relay.example --handoff https://handoff.example
```

Equivalent environment variables are:

```text
AGENTSHARE_RELAY=https://relay.example
AGENTSHARE_HANDOFF=https://handoff.example
```

A compatible handoff deployment must preserve the fragment-secrecy boundary;
the `relay=` query value is non-secret transport metadata, while read,
proposal, and key material remain in the fragment.

Self-hosting is an interoperability property, not an enterprise SKU.
