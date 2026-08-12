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
