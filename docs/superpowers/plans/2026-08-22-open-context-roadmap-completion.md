# Open Context Roadmap Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the concrete, currently implementable gaps between AgentShare v0.2.0 collaborative environments and the current open-context transport vision without inventing unsupported agent integrations or weakening creator review.

**Architecture:** Keep v1 `/s/` handoffs compatible while making v2 `/e/` environments the documented default for Codex and Claude Code. Preserve split-origin capability links, make non-interactive creator publication fail closed, wire existing CLI flags into v2 instead of silently ignoring them, make self-hosted handoff origins first-class, and add relay-independent ACB conformance fixtures. Reconcile all user-facing protocol/release documentation with the code that is actually shipping.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Zod, Vitest, Cloudflare Workers/Durable Objects, npm workspaces.

**Spec:** `docs/VISION.md`, `docs/ROADMAP.md`, `docs/adr/0005-open-context-transport.md`, `SECURITY.md`, `docs/protocol/acb-v1.md`, `docs/protocol/environment-v2.md`, `docs/operations/cloudflare-deployment.md`

## Global Constraints

- AgentShare remains free, open source, and account-free for the core handoff flow.
- Capability URLs are bearer secrets; secret material must not be moved into argv, analytics, logs, or relay-visible query parameters.
- The relay must not receive plaintext context or decryption keys.
- Creator publication must remain review-before-send and fail closed when interactive approval cannot be obtained.
- Unknown or unsupported agent/runtime isolation contracts fail closed.
- `master` is not edited directly; work lands through an isolated branch and PR verification.
- v1 `/s/` behavior remains available through `share-v1`, `open`, and legacy revoke.
- v2 `/e/` links use a trusted handoff origin plus a non-secret `relay=` query origin; read/proposal capabilities and encryption keys remain in the URL fragment.
- Public TTL remains bounded by `MAX_TTL_SECONDS` (72 hours).
- No new agent adapter is advertised without an exact-version isolation review and release-gate evidence.

---

### Task 1: Fail closed when creator approval has no TTY

**Files:**
- Modify: `packages/cli/src/commands/share-v2.test.ts`
- Modify: `packages/cli/src/commands/share-v2.ts`

**Interfaces:**
- Consumes: `shareCaptureV2(capture, options)` and existing explicit `selection` test hook.
- Produces: creator calls without an explicit test/programmatic selection reject on non-TTY instead of silently selecting conversation + project + proposals + 24 hours.

- [ ] **Step 1: Write the failing regression test**

Add a test using the existing fixture relay and a new workspace/state path:

```ts
it("fails closed instead of choosing an unreviewed non-TTY default", async () => {
  const root = await fixture();
  const state = await statePath();
  const handler = createRelayHandler(new InMemoryRelayStore());
  const client = new EnvironmentRelayClient(
    "http://127.0.0.1:8787",
    (input, init) => handler(new Request(input, init)),
  );

  await expect(
    shareCaptureV2(
      {
        sourceAgent: "codex",
        title: "Codex: demo",
        workspaceRoot: root,
        conversation: [],
      },
      { client, statePath: state },
    ),
  ).rejects.toThrow("Interactive creator approval requires a TTY");
});
```

- [ ] **Step 2: Verify RED**

Run in PR CI or a local checkout:

```bash
npx vitest run packages/cli/src/commands/share-v2.test.ts
```

Expected before implementation: the call creates an environment with the non-TTY default rather than rejecting.

- [ ] **Step 3: Implement the fail-closed boundary**

Change `interactiveSelection()` so a missing TTY throws `Interactive creator approval requires a TTY; run AgentShare in an interactive terminal.` rather than returning `defaultShareSelection()`. Keep `options.selection` as an explicit internal/programmatic path used by tests; it does not become a public `--yes` bypass.

Also prevent the existing-environment branch from silently updating on non-TTY when neither `selection` nor `existingEnvironmentId` was explicitly supplied. Explicit `existingEnvironmentId` remains available to internal recovery/tests.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run packages/cli/src/commands/share-v2.test.ts
```

Expected: all v2 share tests pass, including the new rejection.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/share-v2.test.ts packages/cli/src/commands/share-v2.ts
git commit -m "fix: require interactive v2 creator approval"
```

### Task 2: Make v2 CLI flags truthful and self-hosting first-class

**Files:**
- Modify: `packages/cli/src/commands/share-v2.test.ts`
- Modify: `packages/cli/src/commands/share-v2.ts`
- Modify: `packages/cli/src/bin.test.ts`
- Modify: `packages/cli/src/bin.ts`

**Interfaces:**
- Produces: `ShareV2Options.forceNew?: boolean`, `ShareV2Options.ttlSeconds?: number`, and the existing `handoffOrigin?: string` wired from CLI/environment configuration.
- Public flags: `--new`, `--ttl SECONDS`, `--relay URL`, `--handoff URL`.
- Environment fallbacks: `AGENTSHARE_RELAY`, `AGENTSHARE_HANDOFF`.

- [ ] **Step 1: Write failing v2 behavior tests**

Add tests that prove:

```ts
expect(second.environment.environmentId).not.toBe(first.environment.environmentId);
expect(second.environment.sharePolicy.ttlSeconds).toBe(3600);
```

for a second `shareCaptureV2` call with `{ forceNew: true, ttlSeconds: 3600, selection: ... }` against the same workspace. If TTL is not retained directly in `sharePolicy`, assert the relay/environment expiry delta is approximately 3600 seconds instead.

- [ ] **Step 2: Write failing CLI surface tests**

Extend `bin.test.ts` to require help output to mention `--new`, `--ttl`, `--relay`, and `--handoff`, and to reject malformed TTL before any adapter/network work:

```ts
const result = runCli("share", "--current", "--source", "codex", "--ttl", "0");
expect(result.status).toBe(1);
expect(result.stderr).toContain("--ttl must be an integer between 1 and 259200 seconds");
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npx vitest run packages/cli/src/commands/share-v2.test.ts packages/cli/src/bin.test.ts
```

Expected before implementation: `--new`/`--ttl` v2 behavior and `--handoff` help/config assertions fail.

- [ ] **Step 4: Implement v2 option wiring**

In `share-v2.ts`:

```ts
export type ShareV2Options = {
  relayOrigin?: string;
  handoffOrigin?: string;
  forceNew?: boolean;
  ttlSeconds?: number;
  // existing fields...
};
```

Skip workspace existing-environment lookup when `forceNew === true`. After the interactive/programmatic selection is resolved, replace only `ttlSeconds` when an explicit override is present; scope/access still come from reviewed selection.

In `bin.ts`, add `--handoff` to the accepted share options, validate `--ttl` as an integer in `[1, MAX_TTL_SECONDS]`, and pass:

```ts
{
  relayOrigin: option(args, "--relay") ?? process.env.AGENTSHARE_RELAY,
  handoffOrigin:
    option(args, "--handoff") ??
    process.env.AGENTSHARE_HANDOFF ??
    TRUSTED_HANDOFF_ORIGIN,
  forceNew: args.includes("--new"),
  ttlSeconds: parsedTtl,
}
```

Use the same `--handoff`/`AGENTSHARE_HANDOFF` resolution for legacy v1 share creation so self-hosting does not silently point capability links back to the official handoff Worker.

- [ ] **Step 5: Verify GREEN**

Run the same focused Vitest command and confirm all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/share-v2.test.ts packages/cli/src/commands/share-v2.ts packages/cli/src/bin.test.ts packages/cli/src/bin.ts
git commit -m "feat: wire v2 share controls and handoff origin"
```

### Task 3: Reconcile the v0.2.0 handoff release surface

**Files:**
- Modify: `apps/handoff/src/index.test.ts`
- Modify: `apps/handoff/src/index.ts`

**Interfaces:**
- Both `/s/` legacy handoff and `/e/` environment bootstrap pages pin the same immutable `agentshare-0.2.0.tgz` release candidate.
- No change to capability handling or CSP behavior.

- [ ] **Step 1: Change the test first**

Replace the legacy page assertion with:

```ts
expect(html).toContain("agentshare-0.2.0.tgz");
expect(html).not.toContain("agentshare-0.1.11.tgz");
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run apps/handoff/src/index.test.ts
```

Expected: legacy handoff page still contains `agentshare-0.1.11.tgz`.

- [ ] **Step 3: Implement**

Set `PUBLIC_RELEASE` in `apps/handoff/src/index.ts` to `0.2.0`. Do not alter the fragment/history/CSP logic.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run apps/handoff/src/index.test.ts
git add apps/handoff/src/index.test.ts apps/handoff/src/index.ts
git commit -m "fix: pin handoff pages to v0.2.0"
```

### Task 4: Add relay-independent ACB v1 conformance fixtures

**Files:**
- Create: `tests/fixtures/acb-v1/minimal.json`
- Create: `tests/fixtures/acb-v1/minimal.canonical.json`
- Create: `packages/acb/src/conformance.test.ts`
- Create: `docs/protocol/acb-v1-conformance.md`
- Modify: `package.json`

**Interfaces:**
- Produces a stable fixture any implementation can decode and re-encode without using the official relay.
- Adds `npm run test:conformance` as a transport-independent protocol gate.

- [ ] **Step 1: Add the fixture and failing conformance test**

The fixture contains one user event and one text resource (`hello\n`) with exact byte length and SHA-256. The test reads both files, calls `decodeAcb`, `encodeAcb`, `logicalFingerprint`, and asserts the emitted UTF-8 bytes exactly equal `minimal.canonical.json` and that decoding/re-encoding is stable.

- [ ] **Step 2: Verify RED**

Before adding the npm script, run:

```bash
npm run test:conformance
```

Expected: npm reports a missing script.

- [ ] **Step 3: Add the conformance script**

Add:

```json
"test:conformance": "vitest run packages/acb/src/conformance.test.ts"
```

Document how third-party implementations should consume the fixture, preserve unknown-version fail-closed behavior, verify resource byte length/SHA-256, and compare canonical bytes.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm run test:conformance
git add package.json packages/acb/src/conformance.test.ts tests/fixtures/acb-v1 docs/protocol/acb-v1-conformance.md
git commit -m "test: add ACB v1 conformance fixture"
```

### Task 5: Align current documentation with the v2 default and open transport model

**Files:**
- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Modify: `docs/protocol/environment-v2.md`
- Modify: `docs/operations/cloudflare-deployment.md`
- Modify: `docs/ROADMAP.md`
- Modify as needed: `SECURITY.md`, only where v0.2.0 behavior is currently described as v0.1.11/v1-only.

**Interfaces:**
- User docs distinguish v2 default environments from explicit v1 compatibility.
- Self-host docs explain both relay and handoff origins.
- Environment protocol shows split-origin URL form.
- Deployment runbook includes published Durable Object migration `v4` for `EnvironmentObject` and the v0.2.0 release ordering.

- [ ] **Step 1: Update root quick start**

Pin `v0.2.0` for the v2 candidate instructions. Describe the default creator flow (`$agentshare` / `/share`), explicit scope/access/expiry review, one `/e/` link, direct-paste receiver integration, `agentshare bootstrap`, `ask`, `propose`, `inbox`, update/same-link refresh, and `revoke-environment`. Move one-shot v1 instructions under a clearly labeled compatibility section.

- [ ] **Step 2: Correct protocol link form**

Use:

```text
https://<handoff-origin>/e/<environment-id>?relay=https%3A%2F%2F<relay-origin>#r=<read-capability>&k=<environment-master-key>[&p=<proposal-capability>]
```

State that `relay` is non-secret transport metadata while `r`, `k`, and optional `p` are bearer fragment secrets.

- [ ] **Step 3: Update self-host/deployment docs**

Document `--relay`/`AGENTSHARE_RELAY` and `--handoff`/`AGENTSHARE_HANDOFF`. Update the Cloudflare runbook to v0.2.0, require migrations v1-v4, and require `/e/` bootstrap/live v2 verification before package publication.

- [ ] **Step 4: Record roadmap status without pretending speculative work is done**

Add a current-status note to `docs/ROADMAP.md`: v2 link handoff, revisions/proposals, shared quotas, preview/review, and split-origin deployment are implemented; ACB conformance fixtures are implemented in this pass; additional adapters remain demand-driven and blocked on exact isolation evidence; richer ACB semantic fields require an explicit future schema/version decision.

- [ ] **Step 5: Run documentation/format gates and commit**

```bash
npm run format:check
npm run lint
git add README.md packages/cli/README.md docs/protocol/environment-v2.md docs/operations/cloudflare-deployment.md docs/ROADMAP.md SECURITY.md
git commit -m "docs: align AgentShare v0.2 with open context roadmap"
```

### Task 6: Full verification and review gate

**Files:**
- No planned production changes; fixes discovered by verification get their own tests and commits.

- [ ] **Step 1: Run the full repository gate**

```bash
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

- [ ] **Step 2: Verify the cross-platform CI matrix**

Open a PR so the existing GitHub Actions matrix runs on Ubuntu/macOS/Windows with Node 22 and 24. Do not call the branch complete until every job reports success.

- [ ] **Step 3: Review the branch diff against the specs**

Check that the diff does not add accounts, billing, identity dependencies, server-side plaintext, capability logging, silent creator approval, unsupported adapter claims, or removal of v1 compatibility.

- [ ] **Step 4: Record any remaining non-code prerequisites accurately**

A production v0.2.0 release still requires live deployment verification and authenticated real Codex/Claude isolation through `npm run test:release`; do not claim a public release is shipped from CI-only evidence.
