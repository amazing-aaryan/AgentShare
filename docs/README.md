# AgentShare Documentation

AgentShare is the **free, open protocol/tool for securely handing AI context to
anyone through capability links**. The core project deliberately does not
require AgentShare accounts, shared organizations, paid access, or server-side
plaintext context storage.

## Start here

- [`VISION.md`](VISION.md) — mission, principles, users, non-goals, and the
  long-term open transport direction.
- [`../README.md`](../README.md) — current user-facing quick start and behavior.
- [`../SECURITY.md`](../SECURITY.md) — trust boundary, capability-link security,
  and residual risks.

## Protocol

- [`protocol/acb-v1.md`](protocol/acb-v1.md) — Agent Context Bundle, the open
  context interoperability boundary.
- [`protocol/relay-v1.md`](protocol/relay-v1.md) — blind, capability-based
  encrypted transport.

## Architecture decisions

- [`adr/0005-open-context-transport.md`](adr/0005-open-context-transport.md) —
  current project-wide architectural/product direction.
- Earlier ADRs document the host/bootstrap decisions that produced the current
  Codex and Claude Code implementation.

## Operations and evidence

- [`operations/`](operations/) — development, deployment, and repository
  security runbooks.
- [`recipient-compatibility.md`](recipient-compatibility.md) — exact recipient
  host isolation evidence.
- [`releases/`](releases/) — historical release verification records.
- [`superpowers/`](superpowers/) — dated implementation design/plan records.
- [`../plans/`](../plans/) — historical v0 construction plan.

## Authority order

When documents disagree, use this order:

1. current accepted ADRs for explicit decisions;
2. `VISION.md` for mission/principles/non-goals;
3. `SECURITY.md` for current security claims;
4. `docs/protocol/` for current protocol contracts;
5. `docs/operations/` for current operational procedures;
6. current compatibility/release evidence for specific versions;
7. dated/historical plans for provenance only.

Historical documents are intentionally preserved instead of being rewritten to
make old releases or plans appear to have implemented the current vision.
