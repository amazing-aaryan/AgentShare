# ADR 0002: Product and Package Identity

- Status: Accepted
- Date: 2026-08-08

## Decision

Use product name **AgentShare**, executable `agentshare`, unscoped bootstrap
package `agentshare`, and internal workspace scope `@agentshare/*`.

## Why

Registry checks on 2026-08-08 found no npm packages named `agentshare`,
`@agentshare/cli`, or `@agent-share/cli`. A separate Python project already uses
AgentShare, so documentation must always identify this implementation as the
Node.js encrypted agent-context handoff tool.

## Consequences

Package publication still requires npm ownership validation. If unavailable at
release time, publish `@agentshare/cli` while retaining executable `agentshare`;
record the change in a new ADR.
