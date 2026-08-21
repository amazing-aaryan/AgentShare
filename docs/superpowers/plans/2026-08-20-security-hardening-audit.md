# Security Hardening Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the August 2026 AgentShare security audit findings in one reviewable hardening PR.

**Architecture:** Keep the existing split handoff/relay trust model and capability format. Tighten only the browser-facing relay boundary, creator-side scanning, public documentation, and repository security gates. Changes are regression-first and preserve CLI/non-browser behavior.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers/Durable Objects, GitHub Actions, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-20-security-hardening-audit-design.md`

## Global Constraints

- Do not change AgentShare encryption or capability formats.
- Preserve intentional legacy-link compatibility.
- Preserve recipient launcher isolation and current supported target versions.
- Use synthetic credentials only in tests and documentation.
- Keep GitHub Actions permissions read-only unless a job demonstrably needs more.

---

### Task 1: Edge relay browser-boundary regression tests

**Files:**
- Modify: `apps/edge-relay/src/index.test.ts`

**Interfaces:**
- Consumes: default Worker `fetch(request, env)`.
- Produces: regression expectations for trusted metadata CORS and bounded create bodies.

- [ ] Add tests proving only the trusted handoff origin receives CORS on metadata GET/preflight.
- [ ] Add tests proving create/upload/revoke/blob responses do not expose permissive CORS.
- [ ] Add a test sending a create body above 8 KiB and expecting HTTP 413 before Durable Object allocation.
- [ ] Push the tests alone and confirm CI fails for the expected missing behavior.

### Task 2: Edge relay hardening implementation

**Files:**
- Modify: `apps/edge-relay/src/index.ts`

**Interfaces:**
- Consumes: `Request`, existing `createShareRequestSchema`, Durable Object bindings.
- Produces: exact-origin metadata CORS and bounded, single-parse create forwarding.

- [ ] Add `MAX_CREATE_BODY_BYTES = 8 * 1024` and exact trusted handoff origin constant.
- [ ] Reject oversized `Content-Length` immediately; for unknown lengths, read at most the cap plus one byte before parsing.
- [ ] Parse create JSON once at the edge and reconstruct a canonical JSON request for the Share Durable Object.
- [ ] Replace global `cors()` wrapping with route-aware metadata-only CORS.
- [ ] Return preflight only for trusted-origin `GET` metadata requests with `authorization`; reject all other preflights without ACAO.
- [ ] Run branch CI and confirm edge tests and full matrix are green.

### Task 3: Secret scanner regression tests

**Files:**
- Modify: `packages/scanner/src/scanner.test.ts`

**Interfaces:**
- Consumes: `scanAndRedact`.
- Produces: synthetic cases for npm, GitLab, Slack, Stripe, Google API, and Cloudflare API credentials.

- [ ] Add one synthetic positive case per credential family.
- [ ] Add near-miss cases that must not be redacted.
- [ ] Push tests alone and confirm scanner tests fail for the newly unsupported families.

### Task 4: Secret scanner implementation

**Files:**
- Modify: `packages/scanner/src/index.ts`

**Interfaces:**
- Consumes: text/binary resource views.
- Produces: `SecretFinding.kind` values for newly supported credential families while preserving existing redaction semantics.

- [ ] Add conservative token-family patterns using documented stable prefixes/lengths.
- [ ] Keep generic-secret and bearer detection as fallback rather than broadening them to high false-positive rates.
- [ ] Run scanner tests and full CI to green.

### Task 5: Public documentation cleanup

**Files:**
- Delete: `reasoning.md`
- Modify: `docs/protocol/relay-v1.md`
- Modify: `docs/releases/v0.1.10-release-verification.md`
- Modify: `docs/recipient-compatibility.md`
- Modify: `docs/operations/local-development.md`
- Modify: `docs/superpowers/specs/2026-08-18-handoff-trust-and-lifecycle-design.md`
- Modify: `docs/superpowers/plans/2026-08-18-handoff-trust-and-lifecycle.md`
- Modify: `plans/README.md`

**Interfaces:**
- Produces: one current security model and clearly labeled historical implementation records.

- [ ] Rewrite relay protocol docs around `https://<handoff>/s/<id>?relay=<relay-origin>#r=<read>&k=<key>` and explicitly document that only metadata GET is browser-CORS enabled.
- [ ] Reframe the v0.1.10 verification document as a completed release record; retain historical failed checks under a clearly dated incident/history section rather than as current blockers.
- [ ] Remove Cloudflare account ID and Worker deployment UUID from public release documentation.
- [ ] Update compatibility heading/version to v0.1.10.
- [ ] Remove stale “full cross-platform CI” work item from local-development docs.
- [ ] Mark 2026-08-18 spec/plan release ordering as historical and point to the current deployment runbook.
- [ ] Delete `reasoning.md`; update `plans/README.md` to identify old blueprint material as historical/non-authoritative.

### Task 6: CI and repository-admin hardening guidance

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `docs/operations/repository-security.md`
- Modify: `SECURITY.md`

**Interfaces:**
- Produces: automated repository-content secret check plus explicit admin merge blockers.

- [ ] Add a pinned read-only secret-scanning CI step/job that scans the checked-out repository and history available to Actions.
- [ ] Keep existing format/lint/build/coverage/package/edge-runtime/Wrangler/audit checks unchanged.
- [ ] Document branch protection: PR required, CI required, force pushes/deletions blocked, signed commits/releases preferred.
- [ ] Document checking GitHub secret-scanning alerts and push protection.
- [ ] Document `gh release verify v0.1.10` / `gh release verify-asset` and the fact that immutability must be enabled in repository settings for future releases.
- [ ] Link the repository-security runbook from `SECURITY.md`.

### Task 7: Final verification and PR

**Files:**
- Review all changed files.

- [ ] Compare branch against `master` and ensure no unrelated changes.
- [ ] Inspect final GitHub Actions checks; do not claim success unless all required jobs have completed successfully.
- [ ] Open one draft PR against `master` with a security summary, test evidence, and an explicit admin-only checklist for branch protection, secret-scanning alerts, and release immutability.
- [ ] Re-inspect PR file list and checks after creation.