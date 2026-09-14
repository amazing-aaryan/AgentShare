# ADR 0002: Product and Package Identity

- Status: Accepted
- Date: 2026-08-08

## Decision

Use product name **AgentShare**, executable `agentshare`, unscoped bootstrap
package `agentshare`, and internal workspace scope `@agentshare/*`.

## Why

Registry checks on 2026-08-08 found no npm packages named `agentshare`,
`@agentshare/cli`, or `@agent-share/cli`. Separate projects also use the name
AgentShare, so documentation should identify this implementation by its actual
purpose rather than relying on the name alone.

The current canonical description is:

> **AgentShare is the free, open protocol/tool for securely handing AI context
> to anyone through capability links.**

The current implementation is Node.js/TypeScript and first-class host adapters
are Codex and Claude Code. Those implementation details should not be confused
with the long-term protocol scope: ADR 0005 defines AgentShare as an
agent-agnostic open context transport, with the Agent Context Bundle as the
interoperability boundary.

## Consequences

Package publication still requires npm ownership validation. If unavailable at
release time, publish `@agentshare/cli` while retaining executable `agentshare`;
record the change in a new ADR.

Marketing and documentation should not position AgentShare as a paid team
workspace, enterprise account system, or permanent AI-session archive. When name
disambiguation is needed, prefer phrases such as **open agent-context handoff
protocol** or **encrypted capability-link context transport**.

See [`../VISION.md`](../VISION.md) and
[ADR 0005](0005-open-context-transport.md).
