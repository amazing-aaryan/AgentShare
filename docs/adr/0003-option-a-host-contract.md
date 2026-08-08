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

## Consequences

Host-facing text must state `$agentshare` for Codex and `/share` for Claude.
Tests must prove each `codex exec` child is ephemeral, ignores user config and
rules, has read-only permissions, and receives no capability URL or key through
arguments or environment variables.
