# AgentShare reliability and chat — v0.3.0

Approved implementation program. Baseline ba858bbf; working checkout
Desktop/AgentShare/source.

## Scope and invariants

Windows-first Codex-only support; Claude/Linux/macOS unverified. Preserve old
links, crypto/capability boundaries and immutable v0.2.0. Human publication
consent mandatory. Reviewed resource bytes equal published bytes; proposals
publish approved base plus approved ops only; recipient never accesses owner
workspace. No secrets in evidence. No Docker/SQLite, new agents, old OneDrive
deletion, or release before gates.

## Dependency index

- [01-recipient-mcp](01-recipient-mcp.md): dependencies None.
- [02-lossless-scanning](02-lossless-scanning.md): dependencies None.
- [03-immutable-drafts](03-immutable-drafts.md): dependencies 02.
- [04-session-terminal](04-session-terminal.md): dependencies 03.
- [05-safe-proposals](05-safe-proposals.md): dependencies 01,03.
- [06-chat-sharing](06-chat-sharing.md): dependencies 04,05.
- [07-published-gate](07-published-gate.md): dependencies 01–06.
- [08-release](08-release.md): dependencies 07.

## Evidence

Published v0.2.0 upload/bootstrap succeeds, but real MCP calls cancel; exit zero
and preloaded answers do not prove completion. YAML/TOML text mismatch, lossy
UTF8 decode, review/recapture race, whole-workspace proposal republish, and
recorded-root capture confirmed. Cancellation cause remains hypothesis until
pinned-version test.

## Review ledger

Sagan: scanner/data/privacy. Fermat: session/consent/UX. Nietzsche: release
evidence. Parent: MCP investigation, dependencies, synthesis. Planning reviewers
closed. Implementation ledger maintained in reasoning.md. No claim of live
repaired success until exact-artifact test.

## Implementation checkpoint — 2026-08-27

PR1–5 implemented with local tests. PR6 protocol implemented; native app
confirmation/reload remains unverified. PR7 has the offline contract and a
passing packaged real-Codex loopback journey, not public/native certification.
PR8 rollout remains gated; no deployment or installed CLI/skill replacement. See
[implementation handoff](../../../docs/implementation-v0.3.0.md) for exact
artifact identity, remaining gates and verification scope. All three
implementation workers closed.
