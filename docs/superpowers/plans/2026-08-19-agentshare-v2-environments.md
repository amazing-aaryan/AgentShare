# AgentShare v2 Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one-link encrypted collaborative environments with workspace snapshots, isolated recipient Q&A, encrypted proposals, creator approval, revision updates, and v1 compatibility.

**Architecture:** Add a separate v2 environment protocol alongside v1. Environment revisions are immutable encrypted manifests plus deduplicated encrypted blobs. Recipients attach environments locally and delegate questions/proposals to a restricted worker with only AgentShare MCP tools. Proposal plaintext is encrypted specifically to the creator; only creator approval can mutate the real workspace.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Zod, Node crypto/fs/child_process, Vitest, Cloudflare Workers + Durable Objects, existing Codex/Claude integrations.

**Spec:** `docs/superpowers/specs/2026-08-19-agentshare-v2-environments-design.md`

## Global Constraints

- Preserve every existing v1 `/s/` and `/v1/shares` behavior and current release compatibility tests.
- Relay never receives shared plaintext, proposal plaintext, environment master keys, or creator proposal private keys.
- UserB never writes directly to UserA's workspace.
- No v2 shared path may be absolute or escape the creator workspace root.
- Direct-paste is default recipient UX; maximum-privacy local/hidden flow remains available.
- Codex and Claude Code remain fail-closed behind reviewed isolation capability checks.
- Default share: conversation + current project, read + propose, 24 hours.
- All new production behavior follows red/green TDD and every integration slice must leave CI green before continuing.

---

### Task 1: Freeze v1 and add v2 schemas

**Files:**
- Create: `packages/contracts/src/environment.ts`
- Create: `packages/contracts/src/proposals.ts`
- Create: `packages/contracts/src/relay-v2.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: matching `*.test.ts` files

**Interfaces:**
- Produces schemas/types for environment manifests, files, revisions, proposals, relay requests/responses and statuses.

- [ ] Write failing schema tests for valid/invalid environment paths, capabilities, revision parent relationships and proposal operations.
- [ ] Run CI/test target and confirm red failure because schemas do not exist.
- [ ] Implement minimal schemas and exports.
- [ ] Verify focused tests and full CI.

### Task 2: Add environment and proposal cryptography

**Files:**
- Create: `packages/acb/src/environment-crypto.ts`
- Create: `packages/acb/src/proposal-crypto.ts`
- Create: `packages/acb/src/environment-links.ts`
- Modify: `packages/acb/src/index.ts`
- Test: matching `*.test.ts`

**Interfaces:**
- Produces `encryptEnvironmentObject`, `decryptEnvironmentObject`, `generateProposalKeyPair`, `encryptProposalForOwner`, `decryptProposalForOwner`, `buildEnvironmentUrl`, `parseEnvironmentUrl`.

- [ ] Write failing roundtrip/tamper/wrong-key tests.
- [ ] Verify red.
- [ ] Implement HKDF-SHA256 + AES-256-GCM object envelopes and X25519 proposal encryption.
- [ ] Verify green/full CI.

### Task 3: Add safe workspace snapshot package

**Files:**
- Create: `packages/workspace/package.json`
- Create: `packages/workspace/tsconfig.json`
- Create: `packages/workspace/src/{index,discover,enumerate,ignore,snapshot,git}.ts`
- Add fixture tests under package.
- Modify root `tsconfig.json` and dependency graph as needed.

**Interfaces:**
- Produces `discoverWorkspaceRoot`, `enumerateWorkspace`, `buildWorkspaceSnapshot`.

- [ ] Write fixtures and failing tests for ignore rules, credential exclusions, symlink handling, path normalization and outside-root protection.
- [ ] Verify red.
- [ ] Implement minimal safe enumeration and snapshot hashing.
- [ ] Verify green/full CI on Windows/macOS/Linux.

### Task 4: Integrate secret scanning with snapshots

**Files:**
- Modify: `packages/scanner/src/index.ts`
- Test: `packages/scanner/src/scanner.test.ts`

**Interfaces:**
- Produces per-resource scanning and compact snapshot scan summary.

- [ ] Add failing resource/path policy tests.
- [ ] Verify red.
- [ ] Refactor existing scanner without weakening v1 behavior.
- [ ] Verify green/full CI.

### Task 5: Implement in-memory v2 relay state machine

**Files:**
- Create: `packages/contracts/src/environment-machine.ts`
- Create/modify: `apps/relay/src/environment-store.ts`, `environment-handler.ts`, `handler.ts`
- Tests: contract and relay handler tests.

**Interfaces:**
- Implements create/meta/revoke, revision reserve/upload/commit, blob idempotency and encrypted proposal inbox/status.

- [ ] Write failing state transition and capability separation tests.
- [ ] Verify red.
- [ ] Implement state machine and local handler routes.
- [ ] Verify green/full CI.

### Task 6: Implement Cloudflare v2 EnvironmentObject

**Files:**
- Modify: `apps/edge-relay/src/index.ts`, `wrangler.jsonc`
- Tests: `apps/edge-relay/src/index.test.ts`

- [ ] Add failing Worker tests for v2 routing, quotas, capability isolation, expiry and object conflicts.
- [ ] Verify red.
- [ ] Add separate `ENVIRONMENTS` Durable Object and v2 storage.
- [ ] Verify edge runtime/dry-run/full CI.

### Task 7: Add creator state v2 and resumable publication

**Files:**
- Create: `packages/cli/src/environment/state.ts`, `publication.ts`, `cache.ts`
- Tests: adjacent tests.

**Interfaces:**
- Produces owned/attached environment state, pending revision recovery, and incremental blob reuse.

- [ ] Write failing state migration/lock/resume tests.
- [ ] Verify red.
- [ ] Implement `state-v2.json` and publication engine.
- [ ] Verify green/full CI.

### Task 8: Capture workspace roots from host adapters

**Files:**
- Modify: `packages/adapter-codex/src/index.ts`, `packages/adapter-claude/src/index.ts`
- Tests: adapter tests.

**Interfaces:**
- Produces internal `HostCapture` with conversation/title/source/workspaceRoot while retaining v1 exports.

- [ ] Write failing cwd capture tests.
- [ ] Verify red.
- [ ] Implement additive capture APIs.
- [ ] Verify green/full CI.

### Task 9: Build creator selection-only TUI and v2 share command

**Files:**
- Create: `packages/cli/src/tui/{input,renderer,share-flow}.ts`
- Create: `packages/cli/src/commands/share-v2.ts`
- Modify: `packages/cli/src/bin.ts`, integrations.
- Tests: PTY/state-machine tests.

- [ ] Add failing key-input tests proving no required free-form input.
- [ ] Verify red.
- [ ] Implement scope/access/expiry/review/success screens.
- [ ] Verify green/full CI.

### Task 10: Recipient accept, ciphertext cache and index

**Files:**
- Create: `packages/indexer/*`
- Create: `packages/cli/src/commands/accept.ts`, cache/index helpers.
- Tests: package + CLI tests.

- [ ] Add failing accept/incremental-refresh/search tests.
- [ ] Verify red.
- [ ] Implement encrypted cache and lexical/BM25-style index.
- [ ] Verify green/full CI.

### Task 11: Bootstrap page and one-link recipient integration

**Files:**
- Split/modify: `apps/web/src/index.ts`
- Create: `apps/web/src/environment-page.ts`, `bootstrap.ts`, `v1-share-page.ts`
- Modify: `packages/integrations/src/index.ts`
- Tests: web + package E2E.

- [ ] Add failing bootstrap JSON/page/integration tests.
- [ ] Verify red.
- [ ] Implement machine-readable bootstrap and idempotent recipient instructions.
- [ ] Verify green/full CI.

### Task 12: Internal AgentShare MCP and isolated environment worker

**Files:**
- Create: `packages/cli/src/worker/internal-mcp.ts`, `environment-worker.ts`
- Modify/refactor: `launchers.ts`
- Tests: launcher security E2E and MCP tests.

- [ ] Add failing tests proving worker has only AgentShare tools and cannot read host workspace/network.
- [ ] Verify red.
- [ ] Implement environment info/list/search/read/conversation tools and worker launcher.
- [ ] Verify real Codex/Claude isolation release tests.

### Task 13: Proposal staging and submission

**Files:**
- Create: `packages/cli/src/proposals/{overlay,submit,diff}.ts`
- Extend internal MCP.
- Tests: proposal overlay and crypto/relay E2E.

- [ ] Add failing stage/create/replace/delete/diff/submit tests.
- [ ] Verify red.
- [ ] Implement virtual overlay and encrypted submission.
- [ ] Verify green/full CI.

### Task 14: Creator inbox and transactional approval

**Files:**
- Create: `packages/cli/src/proposals/{validate,transaction,apply}.ts`
- Create: `packages/cli/src/tui/inbox-flow.ts`
- Create command: `inbox.ts`
- Tests: filesystem failure injection and conflict tests.

- [ ] Add failing tests for path attacks, stale hashes and rollback after each write boundary.
- [ ] Verify red.
- [ ] Implement validation, encrypted rollback journal, approval UI and deterministic apply.
- [ ] Verify green/full CI.

### Task 15: Publish accepted changes and environment updates

**Files:**
- Modify publication/state/share flows.
- Tests: full local relay environment lifecycle.

- [ ] Add failing E2E: share -> read -> propose -> approve -> same URL reads new revision.
- [ ] Verify red.
- [ ] Implement post-approval revision publication and existing-environment sync.
- [ ] Verify green/full CI.

### Task 16: Release hardening and documentation

**Files:**
- Add protocol/security/bootstrap docs.
- Modify README, release scripts and test package scripts.

- [ ] Add end-to-end release journeys for creator zero-typing, clean recipient bootstrap, proposal non-mutation and approval revision update.
- [ ] Add malicious path/content/capability tests.
- [ ] Run `npm ci`, format check, lint, build, coverage, package, edge runtime, Wrangler dry-run, audit and strict release tests where credentials are available.
- [ ] Review v1 compatibility, v2 threat model and docs before release.
