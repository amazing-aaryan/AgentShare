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
