# Cloudflare Deployment

This runbook operates the **official free public transport** for AgentShare. The
public deployment is a convenience implementation of the open protocol, not an
account, workspace, billing, or organization control plane. Compatible
self-hosted deployments are part of the normal AgentShare model; see
[`../VISION.md`](../VISION.md), the
[Blind Relay Protocol](../protocol/relay-v1.md), and the
[Environment v2 Protocol](../protocol/environment-v2.md).

The official deployment uses two public Workers with different responsibilities:

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

The handoff Worker for a release must pin that release's exact immutable
`agentshare-<version>.tgz` GitHub asset. Stage the exact asset before deploying
a handoff change so the browser bootstrap cannot point at a missing package.
Keep the GitHub release marked as a prerelease until the applicable live release
evidence passes; the AgentShare updater ignores prereleases.

Record the staged asset byte size and SHA-256 before deployment. Do not replace
or mutate the asset after the Worker has been verified against it.

## Deployment Order

Deploy only the production services changed by the release. If relay code,
bindings, or storage behavior changed, authenticate Wrangler and deploy the
relay with the complete published Durable Object migration history intact:

```powershell
npx wrangler login
npx wrangler deploy --config apps/edge-relay/wrangler.jsonc
```

A handoff/package-only patch does not require a relay redeploy. Leaving an
unchanged relay in place avoids unnecessary Durable Object deployment risk.

The required migration sequence is:

- `v1`: `ShareObject`
- `v2`: `RelayControl`
- `v3`: `QueryObject`
- `v4`: `EnvironmentObject`

Never remove, rename, reuse, or renumber a published migration tag.

Deploy the independent handoff Worker whenever its page or bootstrap pin
changed:

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
  exact bootstrap document for the staged release.

A real share or environment is required for complete end-to-end capability and
ciphertext verification.

## Live Release Evidence

After the staged immutable package and all changed Workers are live, verify the
exact release candidate against the public origins. The release gate fails
unless relay and handoff are distinct HTTPS origins. Every release must exercise
the real handoff surfaces, security headers, relay lifecycle semantics,
bootstrap pin, and disposable v1/v2 flows.

Recipient isolation evidence follows the surface changed by the release:

- a new agent adapter or a change to launcher/sandbox authority requires fresh
  real-host filesystem/network isolation evidence before stable promotion;
- a compatibility-preflight-only patch must freshly verify the changed preflight
  against the current published host and prove the restrictive launcher profile
  itself did not change;
- an unchanged adapter on a patch release may carry forward its most recent
  recorded real-host isolation evidence, and the release record must say so
  explicitly.

The current Codex branch changes Windows launcher/sandbox authority, so it falls
under the first rule. The native PARTIAL run against candidate
`27d6537c774c5188e238d393944fda3085a97743` is useful regression evidence but is
**not promotable**: creator publication, direct recipient attachment, and
revocation passed, while the first recipient query failed closed because Codex
0.152.1's unelevated Windows sandbox could not enforce the requested split-read
filesystem profile. Context recovery, negative outside-project isolation,
proposal/approval, and same-link refresh therefore remained unproven.

For the reviewed Windows 11 build 26200 / Node 24.14.0 / Codex CLI 0.152.1
candidate, AgentShare now uses a Windows-specific MCP-only recipient profile:
Codex's built-in `:read-only` permission profile supplies root-readable/no-write
OS isolation with restricted network; an AgentShare-private empty model catalog
forces the explicit `gpt-5.6-sol` slug through fallback metadata without an
apply-patch tool; shell, unified execution, view-image, shell snapshots,
code-mode surfaces, multi-agent delegation, image generation, and local
skill/plugin/app/hook/memory surfaces are disabled; and the AgentShare MCP
server is required with the exact mode-specific enabled-tool list and per-tool
approvals. Linux/macOS keep the stronger split-read filesystem-denial profile.

That Windows profile is pinned to **Codex CLI 0.152.1** until a newer Codex tool
registry is independently reviewed. A stable promotion must not broaden the pin
merely because a newer version passes the general version parser or MCP help
probe.

Before any release candidate containing the Windows profile can become stable, a
fresh native run against the exact candidate must prove all of these together:

- the Windows split-read startup error no longer occurs;
- both workspace-only and conversation-only shared canaries are recovered
  through AgentShare;
- an outside-project canary remains unavailable to the recipient;
- no model-visible host filesystem/shell/delegation path is exposed;
- recipient mutation occurs only as an AgentShare proposal;
- the creator receives and explicitly approves that proposal;
- the same recipient environment sees the approved revision without a new link;
- revocation denies later access;
- capability links, keys, and tokens remain absent from public evidence.

GitHub issue #14 tracks this native Windows acceptance gate. CI and argument
construction are necessary but cannot substitute for the real-host canary test.

The v0.3.0 `codex-only-v1` contract in
[`../release-v0.3.0.md`](../release-v0.3.0.md) is frozen historical evidence for
AgentShare `0.3.0` with its exact reviewed runtime, including Codex CLI
`0.147.0`. Do not reinterpret that profile to cover a newer Codex release, the
Windows MCP-only profile, or a package that contains post-v0.3.0 fixes.

A stable candidate that includes the Codex v2 forward-compatibility and Windows
isolation patches must be staged as a **new immutable package with a new
release-evidence profile**. Its native Codex version and platform-specific
isolation profile must be the exact versions used by the successful
creator-to-recipient run. Before promotion, complete the real terminal and
native chat creation paths through actual MCP read/proposal/inbox/approval/
refresh behavior, isolation, revocation, cleanup, and explicit creator approval.
A version-preflight success or source-checkout run alone is not
published-artifact release evidence.

Claude live execution remains outside the v0.3 collaboration stable-promotion
profile. This narrows release evidence; it does not remove the existing Claude
adapter or claim new Claude compatibility evidence.

When authenticated reviewed Codex and Claude installations are both available,
the repository's full two-agent diagnostic remains useful:

```powershell
$env:AGENTSHARE_E2E_RELAY="https://agentshare-relay.carnation-vermicelli.workers.dev"
$env:AGENTSHARE_E2E_HANDOFF="https://agentshare-handoff.carnation-vermicelli.workers.dev"
npm run test:release
```

`npm run test:release` intentionally still requires both agents. A release using
a narrower explicitly documented profile must not claim that this full
diagnostic passed; its release record instead identifies the exact profile and
evidence that did pass.

AgentShare's agent-agnostic direction does not weaken the fail-closed boundary.
Each newly supported target still requires equivalent real isolation review.

## Promote the Release

Only after the applicable live evidence succeeds should the staged GitHub
release be promoted from prerelease to stable. Promotion changes release
metadata only; it must not replace the verified tarball. Re-download the asset,
verify its recorded byte size and SHA-256, and perform a fresh isolated
installation from the same immutable bytes.

The handoff page/bootstrap must still pin that exact asset. Verify one
disposable v1 share and one disposable v2 environment through the real public
origins before announcing the stable release.

Record the exact commit, package digest, changed Worker deployment identifiers,
fresh recipient evidence, and any explicitly carried-forward adapter evidence
under `docs/releases/`.

## Rollback

A rollback must preserve Durable Object storage and migration history. Do not
delete or recreate the relay namespace to undo an application deployment.

If a defect appears before a candidate is promoted to stable, keep the release
marked as a prerelease, roll back the affected Worker code, and leave the
current stable package as the recommended version. If a defect appears after
promotion, stop promoting the affected release, roll back the Worker code where
safe, and direct users to the recorded safe package version while the incident
is investigated.

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
