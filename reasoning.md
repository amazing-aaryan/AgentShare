# AgentShare Decision Memory

## [2026-08-12 00:08] Approved release-hardening TDD packet

**Decision:** Implement six verified hardening items with RED/GREEN commits,
then release v0.1.7 only after local, CI-equivalent, package, production relay,
agent isolation, browser, and independent adversarial gates pass. **Why:**
v0.1.6 has a capability-link scanner leak, missing REPL conversation continuity,
unbounded Node relay upload buffering, unvalidated ACB resource integrity,
misleadingly narrow coverage, and stale edge create behavior after logical
expiry. **Impact:** Changes are limited to scanner, ACB, CLI recipient flow,
Node/edge relays, coverage config, and aligned docs. Failed gates prevent
tagging or deployment; v0.1.6 and Worker b155efb1-cdc1-4674-a350-f9b50ac04539
remain rollback points.

## [2026-08-12 01:50] Blocked v0.1.7 publication on Claude authentication

**Decision:** Keep v0.1.7 as an unpushed release candidate after all local,
package, edge, production-relay, Codex isolation, and independent code-review
gates passed; do not tag, publish, deploy, or browser-accept until the strict
cross-agent release gate passes. **Why:** Claude Code 2.1.210 is installed but
its OAuth session expired, so both real Claude checks exit 1. Publishing or
deploying now would violate the fail-closed release contract and advertise a
missing v0.1.7 asset. **Impact:** Candidate HEAD is
`cec21f8b6196530035fb07975b6696a7eda2648c`, 14 commits ahead of origin. Resume
with `claude auth login`, then `npm run test:release`; v0.1.6 and Worker
`b155efb1-cdc1-4674-a350-f9b50ac04539` remain rollback points.

## [2026-08-12 11:28] Passed strict cross-agent release gate

**Decision:** Resume v0.1.7 publication after the mandatory production relay,
Codex, and Claude release gate passed all six tests with no skips. **Why:**
Claude Code 2.1.210 is authenticated again; both agents attempted benign
filesystem/network actions and produced no side effects, then passed grounded
two-turn continuity. **Impact:** Candidate may now be pushed, packaged,
released, deployed, and browser-tested under the approved release packet.

## [2026-08-12 11:34] Released and deployed AgentShare v0.1.7

**Decision:** Publish v0.1.7 from commit `78b89d5`, deploy Worker version
`2ffd8937-41e4-40cf-9e27-632ec8fb210d`, and retain v0.1.6 as rollback. **Why:**
Strict cross-agent/live-relay gates, six-platform CI jobs, package smoke,
post-deploy lifecycle tests, browser acceptance, and final independent reviews
passed. **Impact:** Public installation now resolves to immutable asset SHA-256
`b329a4343b0d2b08ad4f14664eff1f7f585be30b463a8e5c923290ec687b19e9`. Mobile
visual acceptance remains unclaimed because the in-app viewport override did not
change from 1280 CSS pixels.

## [2026-08-12 13:02] Security review found two medium risks

**Decision:** Do not describe v0.1.7 as security-clean until terminal control
characters are neutralized and anonymous global-capacity exhaustion is
mitigated; publish the verified capability/trust-boundary README independently.
**Why:** Synthetic review reproduced unsanitized terminal control output and a
UTF-16 binary secret-scan bypass, while relay code permits unauthenticated
72-hour reservations against a global 5,000-share pool. Crypto, bearer
authorization, launcher isolation, dependencies, history secret scan, package,
edge, and strict six-case live release gates passed. **Impact:** Future source
release work must address terminal escaping and relay admission/capacity abuse
first. Binary resource scanning is a low-severity hardening gap because v0.1.7
user adapters do not attach resources.

## [2026-08-12 17:59] Hardened next-release security boundaries

**Decision:** Strip terminal and bidi controls at all CLI external-output sinks,
scan likely UTF-16LE/BE binary views, and bind relay reservations to a hashed
creator source with a 25-active-share cap and 10-minute provisional lease.
**Why:** These changes close the three reproduced review findings while
preserving safe binary resources, delayed upload recovery, idempotency, and the
72-hour uploaded-share limit. **Impact:** Changes live only on
`codex/security-hardening-v0.1.8`; no public release or Worker deployment has
occurred. Distributed capacity abuse and opaque compressed/encrypted resources
remain documented residual risks.

## [2026-08-12 18:10] Removed regex stack risk at resource limit

**Decision:** Replace nested Base64 regex validation with an iterative syntax
validator and test the full 5 MiB resource boundary. **Why:** A valid maximum
resource exhausted the JavaScript regex stack before secret scanning.
**Impact:** Maximum resources now validate and complete binary scanning without
stack failure; Base64 acceptance semantics remain unchanged.

## [2026-08-12 18:18] Completed bidi terminal control filtering

**Decision:** Remove ALM, LRM, RLM, and deprecated directional formatting
controls in addition to overrides and isolates. **Why:** Final adversarial
review found those controls survived while the security policy claimed
bidirectional controls were stripped. **Impact:** CLI display and stored target
output now remove the complete explicit bidi-control set while preserving
ordinary Unicode.

## [2026-08-12 18:22] Made terminal sanitization linear-memory

**Decision:** Replace array-based code-point filtering with a tested global
control-range replacement. **Why:** The array implementation consumed about 199
MiB of heap for 5 MiB input and could exhaust Node's heap near relay-sized
payloads. **Impact:** A 50 MiB hostile-input benchmark completed in 54 ms with
about 50 MiB incremental heap while preserving the same filtering contract.

## [2026-08-13 00:48] Released and deployed AgentShare v0.1.8

**Decision:** Publish the verified security-hardening branch as v0.1.8 and
deploy Worker version `9c3ebe77-a72f-4256-b0ac-14923bd876fc`. **Why:** Local,
cross-platform CI, strict six-case production Codex/Claude, package integrity,
fresh public install, and deployed-page checks all passed. **Impact:** v0.1.8 is
the supported public release; README and share-page commands pin its immutable
GitHub asset.

## [2026-08-13 15:26] Reviewed current Claude releases and fixed recipient preflight

**Decision:** Allow only isolation-reviewed Claude Code 2.1.210, 2.1.223, and
2.1.231, and validate target compatibility before requesting the recipient
capability link. **Why:** Public AgentShare v0.1.8 accepted only 2.1.210 while
Anthropic stable/latest had advanced to 2.1.223/2.1.231; validation also
occurred too late, after link paste and the first question. **Impact:** The next
release can open current stable/latest Claude while retaining fail-closed
behavior for unreviewed versions; unsupported users now fail immediately with
the reviewed-version list. Real filesystem/network isolation and two-turn
grounding passed on both newly allowed releases.

## [2026-08-13 21:00] Expanded only through verified host releases

**Decision:** Support Codex CLI 0.145.0 through 0.147.0 and every published
Claude Code release from 2.1.210 through 2.1.231, except nonexistent 2.1.230,
using exact reviewed profiles plus bounded runtime capability checks before link
entry and every target spawn. **Why:** Help flags alone cannot prove unchanged
security semantics, and an LLM-driven self-test cannot establish a security
boundary for arbitrary future versions. Every added release passed real
filesystem/network isolation; Codex 0.146.0/0.147.0 also passed grounded
two-turn continuity. **Impact:** AgentShare now supports the maximum currently
published and tested host range without weakening fail-closed isolation. Future
releases require the same automated security review before allowlisting.

## [2026-08-13 21:05] Hardened compatibility preflight and separated release state

**Decision:** Revalidate exact reviewed versions before every target spawn;
bound version/help probes with hard deadlines, byte caps, stream shutdown, and
process-tree termination; document per-version evidence while labeling expanded
support unreleased. **Why:** Help-name presence cannot authorize arbitrary host
versions, cached checks create replacement races, hostile probes can retain
pipes after termination, and public v0.1.8 still contains the previous narrow
gate. **Impact:** Unknown or drifted releases fail before link entry, probe DoS
paths fail closed, and users are not told the source-only expansion is already
deployed. A new release and pin update remain required for public availability.

## [2026-08-13 22:27] Made recipient web handoff self-guiding

**Decision:** Replace the compact recipient page with an explicit four-step
journey covering prerequisites, target/version selection, command execution,
hidden-link entry, terminal use, risk disclosure, and error recovery. Keep the
displayed compatibility tied to pinned public v0.1.8 rather than unreleased
source support. **Why:** The earlier page told users what to copy but not why,
what happens next, how to recover from the reported version error, or what
security exposure remains. **Impact:** Recipients can complete the handoff in
order without outside documentation, while bearer-link, provider, endpoint,
untrusted-content, and retention risks remain visible before they proceed.

## [2026-08-13 23:05] Released and deployed AgentShare v0.1.9

**Decision:** Publish the immutable v0.1.9 CLI asset before exposing its URL,
then advance master and deploy the recipient UI to Worker version
`1ed0f7d4-a42a-46a3-881c-a92d0b922bca`. **Why:** Package-first ordering avoids a
live 404 window; strict real-agent gates, anonymous asset verification, and live
browser QA all passed. **Impact:** Expanded reviewed Codex/Claude support,
pre-link validation, and the complete risk-aware recipient walkthrough are now
public. Rollback remains v0.1.8 plus the prior Worker deployment.

## [2026-08-19 11:35] Blocked v0.1.10 publication on expired Claude OAuth

**Decision:** Deploy and verify handoff Worker, but stop release publication
after strict gate failed Claude real-agent tests. **Why:** Claude Code `2.1.210`
is reviewed, but OAuth session expired and could not refresh; production rules
require zero failed/skipped real-agent tests and forbid faking release success.
**Impact:** Handoff deployment `385fd884-d162-4ccc-9934-9fe59d2f1646` is live;
rerun strict gate and all downstream immutable artifact/publication checks after
`claude auth login`.

## [2026-08-21 17:10] Use staged stable release for v0.1.11

**Decision:** Prepare v0.1.11 as a stable patch release in an isolated worktree,
update only active release pins while preserving historical v0.1.10 evidence,
review current Codex 0.149.0 and Claude Code 2.1.238 before allowlisting, then
require exact-commit local, CI, live-agent, package, updater, and published
smoke gates before announcement. **Why:** The delta since v0.1.10 is limited to
CLI-managed updates, but an RC cannot validate the stable-only updater path and
publishing before the handoff pin or compatibility review would create unsafe
recipient failures. **Impact:** Release order is source consistency,
compatibility review, local and six-job CI gates, handoff deployment, strict
production gate, immutable package publication, public updater/upgrade smoke,
live handoff/revoke smoke, and final evidence recording. Relay and Durable
Object migrations remain unchanged unless a verified source diff requires
otherwise.

## [2026-08-21 17:20] Keep Codex 0.149 blocked and allow Claude 2.1.238

**Decision:** Do not add Codex CLI 0.149.0 to the reviewed allowlist; add only
Claude Code 2.1.238 and keep the v0.1.11 strict release gate on Codex 0.147.0.
**Why:** Exact published 0.149.0 passed help-contract inspection but its Windows
sandbox refused to start because it cannot enforce AgentShare's split filesystem
read restrictions with an unelevated restricted token. Claude 2.1.238 denied
filesystem/network attempts and passed grounded two-turn dialogue. **Impact:**
Current Codex fails closed with an explicit unsupported-version path rather than
weakening isolation. Compatibility docs must disclose the 0.149.0 failure, and
future Codex releases require a fresh real isolation review.

## [2026-08-21 17:29] Resolve package smoke install root through npm

**Decision:** Query `npm root --global --prefix <isolated-prefix>` before
invoking the packed CLI instead of assuming `<prefix>/node_modules`. **Why:**
Windows uses `<prefix>/node_modules`, while macOS and Linux use
`<prefix>/lib/node_modules`; exact-candidate CI exposed the platform mismatch.
**Impact:** Clean-install package smoke now validates the same isolated global
installation flow across all six CI jobs without hard-coded npm layout rules.

## [2026-08-21 17:36] Integrate current master security hardening

**Decision:** Merge `origin/master` security hardening into v0.1.11 and deploy
both the hardened relay edge entrypoint and the already pinned handoff Worker.
**Why:** Master advanced during release preparation with scanner coverage and a
new `secure-worker.ts` production boundary; releasing the older candidate would
exclude current security fixes and make the unchanged-relay evidence false.
**Impact:** Candidate SHA, local gates, CI, strict production gate, and relay
version evidence must all be regenerated. Durable Object classes and migrations
remain unchanged, with relay rollback pinned to the pre-hardening deployment.

## [2026-08-21 17:46] Restore deployed QueryObject v3 before relay hardening

**Decision:** Restore the exact active `QueryObject` contract, class, `QUERIES`
binding, and v3 migration from commit `636152e`, then route it through the new
hardened Worker entrypoint with direct lifecycle regression coverage. **Why:**
Cloudflare rejected the first hardened deployment because current master had
dropped the published v3 migration. Active version `dea32c60...` confirms v3 is
`QueryObject`; deploying v1/v2-only source could orphan a live namespace and
break existing encrypted query clients. **Impact:** v0.1.11 cannot freeze until
local gates and six-job CI pass again with all three migrations. Future
deployments must preserve v1 ShareObject, v2 RelayControl, and v3 QueryObject
even when no new migration is introduced.

## [2026-08-21 17:55] Require trusted-origin CORS in production lifecycle test

**Decision:** Updated the strict production lifecycle assertion to require the
configured handoff origin instead of wildcard CORS. **Why:** The hardened relay
intentionally limits browser metadata access to the trusted handoff Worker. The
previous wildcard expectation was stale and weaker than the deployed security
contract. **Impact:** Future production tests must reject CORS regressions that
broaden relay metadata access beyond the configured handoff origin.

## [2026-08-21 18:35] Publish v0.1.11 but hold broad announcement

**Decision:** Published immutable v0.1.11 from exact commit
`63ad80b0a4f2afad3bf66026fff2e4ef0e69df4d`, while holding broad public-beta
announcement. **Why:** Exact source, six-job CI, production Workers, strict
real-agent gate, digest, fresh install, upgrade, published creator approvals,
handoff, and two grounded cited recipient turns passed. Windows PTY automation
did not complete the final same-flow published CLI revoke observation before
expiry. **Impact:** Release remains available and production stays deployed.
Future work must manually or reliably automate published CLI revoke followed by
relay 410 before broad announcement; do not misreport that observation as
complete.

## [2026-08-21 18:41] Clear v0.1.11 announcement hold

**Decision:** Approved broad public-beta announcement after an uninterrupted
published-package flow completed creator approvals, browser handoff, two
grounded cited recipient turns, hidden-link revocation, and post-revoke 410.
**Why:** Final acceptance blocker now has direct evidence from the immutable
public artifact instead of exact-source or partial harness proxies. **Impact:**
v0.1.11 release evidence is complete; no source or production rollback is
indicated.

## [2026-08-26 19:21] Configure Cloudflare deployment credentials

**Decision:** Create one-year Cloudflare Account API token
`AgentShare GitHub Actions` scoped to Carnation Vermicelli account with Workers
Scripts write and Account Settings read; save it as encrypted GitHub secret
alongside account ID. **Why:** Current v0.2.0 prerelease CI is green but
repository had no Cloudflare Actions credentials; least-privilege scope limits
deployment access. **Impact:** GitHub secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` now exist; token value was not committed or printed.
Desktop checkout fast-forwarded to `origin/master` commit `5744dbc`.

## [2026-08-26 19:35] Complete Cloudflare deployment; hold stable promotion on Claude auth

**Decision:** Deploy v0.2.0 relay and handoff Workers through GitHub Actions,
run strict live gate, and keep GitHub release prerelease because Claude
real-agent tests cannot authenticate. **Why:** Cloudflare deployment succeeded
and all v1/v2/Codex checks passed; Claude organization has disabled Claude Code
subscription access and no `ANTHROPIC_API_KEY` is configured. **Impact:** Relay
active version `ad67746a`, handoff active version `8b0e7909`; stable promotion
requires Anthropic API-key auth or organization subscription enablement, then
rerun `npm run test:release`.

## [2026-08-27 16:00] Implement reviewed reliability and chat program

**Decision:** Implement eight saved plans under
.claude/plan/agentshare-reliability-and-chat. Certify Windows build26200,
Node24.14.0 and Codex0.147.0 first; Claude explicitly unverified. **Why:** Later
published-package diagnostic disproved full v2 MCP success: calls cancelled and
no proposal despite exit zero. Earlier relay/legacy tests were insufficient.
**Impact:** No stable promotion before exact-artifact full journey and native
chat consent pass; v0.2.0 remains immutable. Parent owns drafts/state/proposals.
Native workers own scanner, recipient runtime, and release validator in disjoint
scopes; close after integration. No deployments in worker tasks.

## [2026-08-27 21:54] PR2 scanner worker lossless scan handoff (scanner-71-20260827)

**Decision:** Share normalized MIME/strict UTF-8 classification across scanner,
workspace snapshots, and recipient reads/indexing. Preserve clean bytes and
BOM/CRLF; block suspected binary secrets; reject secret operational paths
instead of renaming. Export scanText, assertSafeResourcePath, and
sanitizeResourcePath for parent metadata/proposal integration. **Why:** The
original MIME allowlist rejected YAML/TOML secrets while permissive UTF-8
conversion could corrupt mislabeled binary. Quoted JSON credential keys and v2
environment capability URLs needed coverage; diagnostics must not echo secret
fragments. **Impact:** 71 focused tests across four files pass; scanner
typecheck, focused ESLint, and diff whitespace checks pass. Full CLI typecheck
encountered concurrent out-of-scope owned-snapshot/internal-mcp test edits.
Modified only scanner sources/tests, snapshot/accept and tests, plus this
append-only record; no commits, deployments, public shares, or agents.
Proceeding to user-assigned PR5 apply/inbox work; parent retains
submit/publication ownership.

## [2026-08-27 21:54] PR7 release-evidence worker freezes offline contract (pr7-evidence-6f41)

**Decision:** Added strict codex-only-v1 report/candidate validation, 18
terminal/chat lifecycle checks, observed assertions, archive/attachment SHA-256
and size checks, full Worker identities, resource cleanup accounting, and
explicit-profile dispatch while retaining the legacy both-agent default as
nonpromotable for full v2 evidence. **Why:** Legacy suites and zero process exit
cannot prove actual published-artifact MCP
read/propose/approval/refresh/isolation/revocation success. Independent
candidate inputs prevent a report from choosing its own expected hashes or
deployment IDs. **Impact:** 86 synthetic Node tests passed; owned files pass
Prettier and diff checks. Parent must integrate actual collection against
docs/release-v0.3.0.md; no real-flow, publication, deployment, or
external-service action was performed. Evidence files changed:
scripts/test-release.mjs, scripts/release-evidence.mjs,
scripts/release-evidence.test.mjs, docs/recipient-compatibility.md,
docs/release-v0.3.0.md. Proceeding separately to assigned PR4 session/terminal
lifecycle.

## [2026-08-27 22:00] PR1 recipient MCP receipts and PR5 staging pin (recipient-8c7d-20260827)

**Decision:** Gate v2 Codex to 0.147.0 while preserving legacy 0.145/146
support; use exact per-mode MCP tool allowlists, required server, truthful
annotations, and per-tool approve without changing global never approval or
sandbox isolation. Require trusted metadata-only MCP receipts outside the
recipient workspace for nonempty file/conversation reads and successful proposal
submission. Pin the first staging revision and pass baseRevisionId to
parent-owned submit validation. **Why:** Exit-zero model output and
attempted/cancelled MCP calls do not prove completion. A refreshed revision must
not silently relabel staged operations. Official config reference and the
rust-v0.147.0 schema confirm the scoped approval fields. **Impact:** 32 focused
tests and root TypeScript pass; two opt-in real Codex 0.147.0 local synthetic
MCP tests pass (ask 17.4s; propose 19.5s), with receipts and no cancellation.
This is not public relay/apply or release evidence. Parent received interfaces
and bounded read-only findings for recovery identity/commit receipts, stale-lock
unlink race, Windows storage ACLs, stale ownership resurrection, and cross-root
updates; parent reported fixing the first three. Changed launchers/tests, worker
completion/internal-MCP/environment-launcher/tests and local fixture test,
ask-v2/propose-v2/tests only. No commits, pushes, deployments, public shares, or
recursive delegation.

## [2026-08-27 22:01] Recipient final parent review handoff (recipient-8c7d-final)

**Decision:** Finish the bounded read-only review after inspecting parent fixes
for persisted ownership, locked recovery identity, exact commit receipts,
approved workspace rebinding, exact owner ACLs, and protected state/backup
staging. Report the remaining legacy generation-zero ownership resurrection edge
for parent disposition; do not edit parent-owned modules. **Why:** New
generation checks distinguish removed v3 ownership but cannot distinguish a
stale generation-zero v2 object from a fresh creation. Parent retains migration
and state authority. **Impact:** Recipient focused suite still passes 32 tests;
scoped ESLint, Prettier, and diff checks passed. Latest root TypeScript run was
interrupted by concurrent removal/rewrite of parent/other-worker
proposals/apply.ts (four missing-module diagnostics), after an earlier full
typecheck passed. Parent owns final full app/package/public lifecycle
validation. Real local MCP evidence remains 2/2 passing and does not establish
public release readiness.

## [2026-08-27 22:10] PR4 terminal/session lifecycle handoff (pr4-terminal-6f41)

**Decision:** Bound Codex capture to explicit/host session ID with metadata
validation and configured CODEX_HOME; added explicit project relocation while
preserving recorded roots. Terminal publication now reviews and commits one
encrypted persisted draft with cancel default, paginated retained text, binary
metadata only, and authoritative relay/scope/target/base/cutoff/root fields.
Added saved-state copy, explicit environment selection and scoped repair/revoke
without transcript capture. Added creator-mcp, doctor, session-context and
same-draft review CLI branches. **Why:** Eliminate newest-session guessing,
preview/recapture races, implicit publication approval, binary decoding,
silently chosen duplicate environments, and unscoped recovery. Metadata-only
adapter callers can report missing recorded roots; explicit projectRoot or
validateProjectRoot performs access validation. Parent owns creator MCP, draft
storage/publication, integrations, and proposal changes. **Impact:** Final
focused run passed 21/21 tests across adapter, share-v2, runtime-v2 and bin (97
seconds). All eight owned files pass ESLint/Prettier and tracked diff checks.
The three-publication relocation test has a 60-second timeout for actual Windows
ACL helpers; other global timeouts unchanged. Latest TypeScript run reports only
sibling proposals/apply.test.ts:169 possibly undefined; no sibling edits made.
PR7 separately passed 86 fixture tests. Changed PR4 files:
packages/adapter-codex/src/index.ts and adapter.test.ts;
packages/cli/src/commands/share-v2.ts and share-v2.test.ts;
commands/runtime-v2.ts and new runtime-v2.test.ts; packages/cli/src/bin.ts and
bin.test.ts. No commits, pushes, deployments, public shares, live agent tests,
integration installs, or recursive agents. Parent proceeds to packaged
local-relay diagnostic, explicitly nonpromotable; real full-flow evidence
remains required.

## [2026-08-27 22:17] PR5 apply/inbox worker scoped approval handoff (scanner-pr5-93-20260827)

**Decision:** Implement proposal review against authenticated committed
readOwnedSnapshot data, pin proposal/base/outbound digest, revalidate under
withEnvironmentLock, and publish only the base plus approved operations through
preparedCapture. Preserve the legacy capture argument without reading it.
Enforce shared membership, raw owner hashes, current ignore/credential rules
including ancestor directories, safe portable paths/junction checks, strict
content scanning, and bounded sizes. Inbox keeps a sanitized shared-base diff in
the decision prompt, defaults to Cancel, and accepts an optional environment ID
scope. **Why:** Approval must not recapture unrelated owner files or
conversation, expose raw private content during review, or silently reapply
after a crash. Per-operation encrypted journal phases permit guarded rollback
and exact publication retry while preserving conflicting local edits.
**Impact:** Final combined run passed 93/93 tests across six files (206
seconds), including actual Windows private-store ACL enforcement. The final
expanded ignore/path test separately passed after strict ignore decoding and
ancestor-policy tightening. CLI TypeScript, owned-file ESLint, Prettier, and
diff checks pass. Journals use .agentshare-private/transactions; existing
records are hardened before reads, new encrypted files inherit enforced
owner-only ACLs, outgoing revision IDs are persisted and passed to pinned
recovery. Legacy journals fail closed for manual recovery. Node path/hash checks
do not provide an OS-wide atomic CAS against arbitrary external filesystem
writers. PR5 changed only packages/cli/src/proposals/apply.ts and apply.test.ts,
packages/cli/src/commands/inbox-v2.ts and new inbox-v2.test.ts; PR2 files were
recorded above. Parent retains publication, submit, state, private-store, and
full integration/release ownership. No commits, pushes, deployments, public
shares, source-session capture, or recursive agents.

## [2026-08-27 22:30] Integrate candidate; retain release and native-host gates

**Decision:** Integrated all three workers; closed Dewey, Leibniz and Hooke.
Parent completed immutable encrypted drafts, exact commit/recovery identity,
generation-zero removal tombstones, protected state migration/backup, shared
owner-only Windows ACL enforcement including config staging/backup, creator MCP
native form protocol and proposal/revoke approvals. Preserved saved update
expiry and binary-only metadata review. Offline contract verification explicitly
returns nonpromotable because attachment hashes do not attest native consent.
**Why:** A passing model process or synthetic form response is not human consent
or published-artifact proof. Parent reviews caught race, ACL and presentation
gaps beyond the initial parallel patches. **Impact:** Latest packaged real Codex
loopback journey passed all seven stages with synthetic fixture confirmations.
Retained 154248-byte candidate SHA-256
ff62c0780fc68867cffd2e253f8a008c2a694e257b2d15736ef300752926c61a under ignored
artifacts. Lint/build/package/format and targeted security checks passed; final
suite result recorded separately. Native app/PTY/public artifact gates remain
outstanding; no commit/push/deployment/release/global install/config or skill
rollout. See docs/implementation-v0.3.0.md. Agent ledger: three closed, none
open. Old OneDrive session directory remains a pointer, not source checkout.

## [2026-08-27 22:31] Final integrated local verification

**Decision:** Retain the tested local candidate without promoting it. **Why:**
Final full Vitest run passed 325 tests across 61 suites, with eight opt-in tests
skipped; the offline validator passed 86 fixtures. Expanded creator consent
tests separately passed six cases after adding cancel, wrong-request and timeout
coverage. Latest packaged handoff passed seven stages. **Impact:** These results
support local implementation, not native host or public release certification.
Full release collection and local rollout remain pending; no workers remain
open.

## [2026-08-28 11:31] Register isolated candidate for native MCP testing

**Decision:** After explicit user approval, register agentshare_creator in the
user Codex config using the retained ff62c0780fc6 candidate archive.

**Why:** Native-app confirmation cannot be tested until the host loads the
candidate server. The existing installed CLI and skill must remain intact.

**Impact:** Isolated installation and test state live under ignored artifacts/
native-mcp-ff62c0780fc6. Original config is preserved byte-for-byte in
C:/Users/aarya/.codex/config.toml.agentshare-backup. Unrelated config, installed
CLI and skill hashes remain unchanged; config has an exact owner-only ACL. Codex
CLI parses the registration; a read-only transport probe passed startup, ping
and all nine tool definitions. No sharing or approval was performed. Current
task tool catalog still lacks agentshare_creator; user must reload or restart
Codex before native confirmation testing. Native UI and public release gates
remain unverified. Receipt: artifacts/native-mcp-registration.json. Rollback
should remove only the managed block, preserving later user edits.

## [2026-08-28 12:09] Native tools loaded; publication approval cancelled

**Decision:** Test the connected creator MCP with one synthetic workspace file.

**Why:** Verify native-host behavior without sharing the user conversation or
source project. Exact current thread resolution and retained review succeeded.

**Impact:** All nine tools loaded after restart. Draft
draft_e3254fb5-298c-49e7-8e5b-c127eba16e17 contains only synthetic notes.txt
(142 bytes), no conversation, read/propose access and a one-hour lifetime.
Commit returned cancellation before publication; status remains prepared. Do not
retry consent automatically. Ask whether the user saw and declined the native
dialog or whether cancellation occurred without a visible prompt. No public
share exists from this attempt; positive native consent is unverified.

## [2026-08-31 10:05] Fixed cross-platform rollback fault-injection test

**Decision:** Resolve proposal-apply renames through the shared fs/promises
module namespace. **Why:** macOS CI did not observe the test's rename spy on a
directly imported binding; Windows passed by runtime behavior. Production
semantics remain unchanged. **Impact:** Local proposal suite passes 16/16. CI
candidate needs rerun before any public package/release publication.

## [2026-08-31 10:11] Hardened macOS test portability

**Decision:** Mock the shared rename function directly and compare relocated
roots after realpath normalization. **Why:** macOS ESM mocking did not replace a
namespace property reliably, and `/var` resolves to `/private/var` on hosted
runners. **Impact:** Proposal and Codex adapter suites pass 20/20 locally. Push
fix for full CI matrix.

## [2026-08-31 10:25] Made rollback tests deterministic across runners

**Decision:** Exercise clean rollback with a pre-existing create target and
concurrent-edit preservation with a post-apply journal failure. **Why:**
Built-in fs interception remains runtime-specific on hosted macOS; deterministic
seams preserve coverage of both rollback outcomes. **Impact:** Both rollback
cases pass locally; prior production code restored unchanged. CI must rerun on
this test-only fix.

## [2026-08-31 10:31] Published v0.3.0 Codex-only public beta

**Decision:** Publish immutable GitHub prerelease `v0.3.0` after green CI and
live Codex-only production checks; exclude Claude live tests. **Why:** User
requested public release work without Claude testing. Beta status and native
consent limitation must remain explicit. **Impact:** Release URL is public,
artifact SHA-256 is
`7f701516ca92adb71fb2b1f36522a27084d00b36a7f44c74766e44a0574353d1`, and live
bootstrap serves `0.3.0`. Stable-release sign-off remains blocked on native
creator consent/public-share evidence and future Claude validation.

## [2026-08-31 10:53] Native consent cancelled again without publication

**Decision:** Retry the native creator consent flow only after the user's explicit
request, using four synthetic fixture files and no conversation content.
**Why:** Close the remaining public-beta consent evidence gap without exposing
private project or chat data.
**Impact:** Draft `draft_31dbf954-b86b-47a8-bc3c-7fcc9daa6045` remains prepared;
commit returned immediate cancellation and created no public share. Do not retry
again without confirming whether a native approval form was visible to the user.

## [2026-08-31 15:53] Repointed creator MCP to public v0.3.0 artifact

**Decision:** Install the verified public release tarball in an isolated directory
and update only the managed creator MCP executable path, preserving the existing
test state path. **Why:** Two consent attempts were cancelled before the native
form rendered, while Codex was still running a retained pre-release artifact.
**Impact:** Codex must reload before another attempt. No consent was simulated and
no share was published; retry only after reload and explicit user confirmation.

## [2026-08-31 19:28] Used terminal consent fallback after chat form failure

**Decision:** Prepare a fresh v0.3.0 terminal draft from only the four synthetic
fixtures, then stop at the exact-draft publication prompt for user confirmation.
**Why:** The chat MCP form bridge auto-cancelled, while the in-app terminal gives
the user a direct interactive approval surface without weakening consent.
**Impact:** Draft `draft_c2521a0d-18bf-4178-a33b-17a2aa812aff` has digest
`ed146855acd530142b25ccf964c4cbbc66b1acdbdcd3e463fa6673f6c56cd961`, no
conversation, 4 files/1508 bytes, read+propose, 900-second TTL. Publication is
pending user selection; no share exists yet.

## [2026-08-31 21:17] Native v0.3.0 form still auto-cancelled after reload

**Decision:** After removing an abandoned lock whose owner PID no longer existed,
prepare and fully review a fresh safe draft, attempt native commit once, then move
the same immutable draft to terminal review when the host cancelled immediately.
**Why:** User explicitly requested another attempt; terminal fallback preserves
human consent while avoiding another capture.
**Impact:** Draft `draft_5945c771-b7c1-4302-aea2-95063d85b3bc`, digest
`e12dcf33708ea28a3bd4cc99aba0ba9c020f1d122cd840140ba48e81cf8344eb`, is
awaiting user approval in terminal session 69603. It contains 4 synthetic files,
1508 bytes, no conversation, read+propose, 900-second TTL. No share yet.

## [2026-08-31 21:33] Commit all release-session documentation

**Decision:** Commit the accumulated native-consent findings and all untracked
AgentShare reliability plan documents together, as explicitly requested.
**Why:** Preserve the complete local release and design record in Git.
**Impact:** The commit records the unresolved native Codex consent UI blocker;
publishing the commit remains a separate push operation.
