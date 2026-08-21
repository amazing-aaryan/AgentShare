# Superpowers Design and Plan Records

Files under `docs/superpowers/specs/` and `docs/superpowers/plans/` are dated
implementation records. They preserve the design and execution context that was
approved at the time; they are not an independent source of current production
security policy.

For current behavior and release procedures, use this authority order:

1. `SECURITY.md`
2. `docs/protocol/`
3. `docs/operations/`
4. current release-verification records
5. dated Superpowers specs and plans

In particular, the 2026-08-18 handoff trust/lifecycle spec and implementation
plan record historical package/deployment ordering from development. The current
production rule is the one in `docs/operations/cloudflare-deployment.md`: deploy
and verify a required handoff endpoint before publishing a creator package that
generates links to it.

When a dated design or plan conflicts with current security, protocol, or
operations documentation, the current documentation is authoritative.
