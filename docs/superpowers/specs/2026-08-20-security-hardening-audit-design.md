# Security Hardening Audit Design

## Goal

Close the concrete findings from the August 2026 repository security audit without changing AgentShare's cryptographic format, capability semantics, recipient-launcher isolation, or intentional legacy-link compatibility.

## Scope

1. **Edge relay browser boundary**
   - Cross-origin browser access is limited to the trusted handoff metadata flow.
   - Create, upload, revoke, and blob download routes do not emit permissive CORS headers.
   - Preflight only succeeds for the metadata GET flow from the trusted handoff origin.
   - `POST /v1/shares` rejects oversized request bodies before JSON parsing, with an 8 KiB limit.
   - The edge parses the create request once and forwards a canonical validated JSON body to the Durable Object.

2. **Creator-side secret scanning**
   - Extend detection to common standalone credential families not reliably caught by generic assignment patterns: npm, GitLab, Slack, Stripe, Google API, and Cloudflare API tokens.
   - Preserve redaction behavior for text and fail-closed behavior for binary resources.
   - Add synthetic regression cases only; never add live credentials to fixtures.

3. **Public documentation and metadata**
   - Make `docs/protocol/relay-v1.md` authoritative for the v0.1.10 split handoff/relay URL model.
   - Reconcile `docs/releases/v0.1.10-release-verification.md` so released state and historical blocking incidents are not contradictory.
   - Update recipient compatibility text to v0.1.10.
   - Remove `reasoning.md` from the public tree; durable decisions belong in reviewed ADRs/specs, not an operational diary.
   - Remove unnecessary Cloudflare account/deployment identifiers from public release documentation while retaining reproducible public verification data.
   - Mark historical implementation plans/specs as historical where their release ordering differs from the current runbook.

4. **Repository security gates**
   - Add a lightweight repository-content secret scan to CI using a pinned third-party action or deterministic local scanner with read-only permissions.
   - Keep package allowlist verification in CI and document the required package contents.
   - Add `docs/operations/repository-security.md` describing admin-only settings: protect `master`, require CI, prevent force pushes, inspect secret-scanning alerts, enable/verify immutable releases, and prefer signed commits/releases.

## Trust Boundary

The handoff Worker remains the only browser origin expected to read relay metadata cross-origin. The read capability is sent to the relay only for `GET /v1/shares/:id/meta`; the decryption key remains in the URL fragment and must never reach the relay. CLI and other non-browser clients are unaffected by CORS.

The production handoff origin for v0.1.10 is `https://agentshare-handoff.carnation-vermicelli.workers.dev`. CORS must compare the request `Origin` exactly against that origin and must not reflect arbitrary origins.

## Error Behavior

- Oversized create request: HTTP 413 with `PAYLOAD_TOO_LARGE`.
- Invalid/missing create body length or malformed JSON: existing 400 behavior remains.
- Disallowed browser preflight: HTTP 404/405 without an `Access-Control-Allow-Origin` header.
- Allowed metadata responses include `Access-Control-Allow-Origin` for the trusted handoff origin and `Vary: Origin`.

## Testing

Use regression-first tests. Edge tests cover allowed metadata CORS, rejected mutation/blob CORS, preflight behavior, oversized create bodies, and single-parse forwarding. Scanner tests cover each new synthetic credential family and verify benign near-misses remain untouched. Existing unit, edge-runtime, package, formatting, lint, build, coverage, audit, and Wrangler dry-run checks must remain green.

## Non-Code Administration

Source control cannot itself enforce GitHub branch rules or retroactively make an existing release immutable. The PR therefore documents exact admin settings and verification steps. These remain explicit merge blockers until checked in GitHub settings/release UI or an authorized repository-admin API.