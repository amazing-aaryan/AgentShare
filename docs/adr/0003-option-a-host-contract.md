# ADR 0003: Option A Host Contract

- Status: Accepted
- Date: 2026-08-08

## Decision

Claude creators receive exact user-level `/share`. Codex creators receive an
explicit-only `$agentshare` skill because current Codex removed custom slash
commands. Both delegate to the same `agentshare share` CLI.

Claude recipients use a strictly configured native session. Codex recipients use
an AgentShare terminal REPL backed by
`codex exec --ephemeral --ignore-user-config --ignore-rules`. The REPL, not the
native Codex interactive TUI, owns conversation continuity and exposes only
AgentShare retrieval context.

## Why

This is Option A from ADR 0001. It preserves current Codex and Claude support
without weakening the query-only security boundary.

The host contract is now understood as an **adapter contract**, not the permanent
scope of AgentShare. ADR 0005 defines the broader direction: host-specific
creator sessions normalize into the open Agent Context Bundle, and recipient
adapters consume locally decrypted ACB evidence under an equivalent isolation
boundary.

## Consequences

Host-facing text must state `$agentshare` for Codex and `/share` for Claude.
Tests must prove each `codex exec` child is ephemeral, ignores user config and
rules, has read-only permissions, and receives no capability URL or key through
arguments or environment variables.

New agent families may be added without superseding this ADR if their adapters
preserve the same higher-level requirements:

- explicit creator invocation and review;
- ACB-compatible context representation;
- no unrelated workspace access added by AgentShare;
- recipient processes constrained against unrelated filesystem, shell, network,
  plugin, browser, memory, or user-configuration surfaces as applicable;
- capability links/keys kept out of persistent or observable child-process
  channels;
- exact supported releases reviewed and fail-closed on drift.

Agent-agnostic direction is therefore **additive interoperability**, not a reason
to accept weaker recipient isolation.

See [`../VISION.md`](../VISION.md), ADR 0005, and
[`../recipient-compatibility.md`](../recipient-compatibility.md).
