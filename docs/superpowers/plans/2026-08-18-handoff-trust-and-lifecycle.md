# AgentShare Handoff Trust and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all review findings while preserving encrypted handoff compatibility and fail-closed recipient isolation.

**Architecture:** Keep the relay protocol and AES envelope unchanged. Change creator state semantics and approval flow in the CLI, then introduce an independent static handoff Worker and extend capability URLs with a non-secret relay origin so the page reading the fragment is no longer supplied by the ciphertext relay. Maintain legacy-link parsing for v0.1.9.

**Tech Stack:** Node.js 22+, TypeScript, Vitest, npm workspaces, Cloudflare Workers/Durable Objects, Zod.

**Spec:** `docs/superpowers/specs/2026-08-18-handoff-trust-and-lifecycle-design.md`

## Global Constraints

- Public CLI must not expose a noninteractive creator approval bypass.
- Every live share must retain its own local revocation credential until revoked or expired.
- New-format capability links must separate trusted handoff origin from ciphertext relay origin.
- Read capability and AES key remain fragment-only; relay origin is non-secret query metadata.
- Legacy v0.1.9 links remain readable.
- Relay API endpoints and AES envelope format remain unchanged.
- Existing target isolation gates remain fail-closed and unchanged.

---

### Task 1: Preserve multiple live creator shares

**Files:**
- Modify: `packages/cli/src/state.test.ts`
- Modify: `packages/cli/src/state.ts`
- Modify: `packages/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: `saveShare`, `findReusableShare`, `findShareByUrl`, `loadState`.
- Produces: state semantics where records are unique by `(relayOrigin, shareId)` and reuse selects the newest matching live fingerprint.

- [ ] Add a failing test that saves two records with the same fingerprint/relay but different share IDs and expects both records to remain.
- [ ] Add a failing test that expects `findReusableShare` to select the newest unexpired matching record.
- [ ] Run the focused state tests and confirm the first test fails because `saveShare` currently removes the old record.
- [ ] Change `saveShare` to replace only the same `(relayOrigin, shareId)` record and sort/select reusable shares by newest expiry/creation surrogate available in state order.
- [ ] Run focused state and CLI tests until green.

### Task 2: Remove public approval bypass and confirm reuse

**Files:**
- Modify: `packages/cli/src/bin.ts`
- Modify: `packages/cli/src/commands.ts`
- Modify: `packages/cli/src/cli.test.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Consumes: `shareCommand(options)` and terminal `confirm()`.
- Produces: internal `assumeApproved?: boolean` library option; public CLI rejects `--yes`; existing-link reuse requires explicit approval unless the internal test option is active.

- [ ] Add a failing executable-level test that `agentshare share ... --yes` exits nonzero with an unsupported-option message.
- [ ] Add a failing library test that a declined live-link reuse creates a fresh share instead of returning the existing URL.
- [ ] Rename the internal option from `yes` to `assumeApproved` and stop parsing `--yes` in `bin.ts`.
- [ ] Reject unknown command options so `--yes` cannot be silently ignored.
- [ ] Before returning a reusable share, show fingerprint/expiry and ask `Reuse this existing live share?`; declining falls through to normal review/new creation.
- [ ] Update integration copy to state that creator confirmation cannot be bypassed.
- [ ] Run CLI/integration tests until green.

### Task 3: Separate handoff origin from relay origin

**Files:**
- Modify: `packages/acb/src/capabilities.ts`
- Modify: `packages/acb/src/acb.test.ts`
- Modify: `packages/cli/src/commands.ts`
- Modify: `packages/cli/src/handoff.ts`
- Modify: `packages/cli/src/relay-client.ts`
- Modify: `packages/cli/src/public-handoff.e2e.test.ts`

**Interfaces:**
- `buildShareUrl({ handoffOrigin, relayOrigin, shareId, readCapability, fragmentKey }) -> string`.
- `parseShareUrl(value) -> { shareId, readCapability, fragmentKey, handoffOrigin, relayOrigin, safeUrl }`.
- Legacy links without `relay=` set `relayOrigin = handoffOrigin`.

- [ ] Add failing ACB tests for a new-format link whose handoff and relay origins differ and for legacy parsing compatibility.
- [ ] Add a failing handoff test proving `openShare` uses parsed `relayOrigin` rather than page origin.
- [ ] Implement strict HTTPS-or-loopback origin validation shared by URL construction/parsing.
- [ ] Update `shareCommand` to construct links with a handoff origin option/default independent from relay origin.
- [ ] Update recipient `openShare` to instantiate `RelayClient(parsed.relayOrigin)`.
- [ ] Run ACB and CLI handoff tests until green.

### Task 4: Add an independent static handoff Worker

**Files:**
- Create: `apps/handoff/package.json`
- Create: `apps/handoff/tsconfig.json`
- Create: `apps/handoff/wrangler.jsonc`
- Create: `apps/handoff/src/index.ts`
- Create: `apps/handoff/src/index.test.ts`
- Modify: `apps/web/src/index.ts`
- Modify: `apps/web/src/page.test.ts`
- Modify: `apps/edge-relay/src/index.ts`
- Modify: `apps/edge-relay/src/index.test.ts`

**Interfaces:**
- Handoff Worker serves `GET /s/:shareId` via `renderSharePage()` and has no storage/capability bindings.
- Page reads non-secret `relay` query parameter and sends metadata requests to that origin.
- Edge relay no longer constructs or advertises new share-page URLs.

- [ ] Add failing page tests asserting metadata fetch targets the `relay` query origin and invalid relay origins keep copying disabled.
- [ ] Add a failing handoff Worker test for static page headers and route handling.
- [ ] Implement `apps/handoff` with restrictive no-store/CSP/referrer/nosniff/frame headers.
- [ ] Update page script to validate relay origin, strip visible query/fragment state, and call `${relayOrigin}/v1/shares/.../meta` with the read token.
- [ ] Remove normal `/s/:id` page serving from edge relay for new deployment behavior; retain an explicit legacy response only if required by compatibility tests/spec.
- [ ] Run web/handoff/edge tests until green.

### Task 5: Align release/package/docs and binary review wording

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `apps/web/src/index.ts`
- Modify: `docs/operations/cloudflare-deployment.md`
- Modify: `scripts/test-package.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Source release target becomes `0.1.10`.
- Deployment order is package asset -> handoff Worker -> relay Worker -> public documentation.

- [ ] Add/adjust tests that pin the source handoff page to v0.1.10 and package smoke expects the new version.
- [ ] Update public docs to distinguish exact text review from binary inventory/hash review.
- [ ] Document new-format malicious-relay protection and legacy-link trust limitation.
- [ ] Add handoff Worker dry-run to CI.
- [ ] Run formatting, lint, build, coverage, package, edge-runtime, and Worker dry-runs.

### Task 6: Full verification and branch handoff

**Files:** No new production files.

- [ ] Run the complete GitHub Actions matrix on the branch and require all jobs green.
- [ ] Inspect the final diff against this spec for accidental weakening of crypto, relay authorization, or target isolation.
- [ ] Confirm regression tests cover all four original findings plus binary-review wording.
- [ ] Prepare a concise branch summary and remaining deployment sequencing note; do not merge to `master` without explicit user direction.
