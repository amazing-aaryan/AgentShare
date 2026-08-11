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
