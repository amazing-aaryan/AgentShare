# Superpowers Design and Plan Records

Files under `docs/superpowers/specs/` and `docs/superpowers/plans/` are dated
implementation records. They preserve the design and execution context that was
approved at the time; they are not an independent source of current product
vision or production security policy.

AgentShare's current direction is the free/open, account-free,
capability-based context transport described in [`../VISION.md`](../VISION.md)
and [ADR 0005](../adr/0005-open-context-transport.md). Historical design records
should not be read as a plan to build a SaaS workspace, organization boundary,
paid tier, or central plaintext knowledge store.

For current decisions, use this authority order:

1. `docs/VISION.md` for project mission, principles, and non-goals
2. accepted ADRs, especially ADR 0005, for architectural/product decisions
3. `SECURITY.md` for the current trust boundary and residual risks
4. `docs/protocol/` for current interoperability/transport contracts
5. `docs/operations/` for current release and deployment procedures
6. current release-verification records for evidence about a specific release
7. dated Superpowers specs and plans for implementation history

In particular, the 2026-08-18 handoff trust/lifecycle spec and implementation
plan record historical package/deployment ordering from development. The current
production rule is the one in `docs/operations/cloudflare-deployment.md`: deploy
and verify a required handoff endpoint before publishing a creator package that
generates links to it.

Dated plans should remain historically accurate. When they conflict with the
current vision, security model, protocol, or operations documentation, the
current authoritative documents above win.
