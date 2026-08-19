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
**Decision:** Deploy and verify handoff Worker, but stop release publication after strict gate failed Claude real-agent tests.
**Why:** Claude Code `2.1.210` is reviewed, but OAuth session expired and could not refresh; production rules require zero failed/skipped real-agent tests and forbid faking release success.
**Impact:** Handoff deployment `385fd884-d162-4ccc-9934-9fe59d2f1646` is live; rerun strict gate and all downstream immutable artifact/publication checks after `claude auth login`.
