# ADR 0005: Open Context Transport Direction

- Status: Accepted
- Date: 2026-08-21

## Context

AgentShare's implemented security model already uses client-side encryption,
blind ciphertext relay storage, capability links, explicit creator review, an
Agent Context Bundle, and isolated recipient agents. The product can therefore
be described either as a hosted team/session-sharing service or as an open
transport layer for handing agent context across people, machines, and agent
vendors.

A hosted workspace model would naturally pull the architecture toward accounts,
organization membership, persistent plaintext indexing, team archives, seat
management, and service-side knowledge features. Those requirements are not
necessary for AgentShare's core job and would weaken its strongest portability
and trust properties.

## Decision

AgentShare is an **open, free, capability-based transport for AI context**.

The project will optimize the core flow around:

`agent context -> creator review -> local encryption -> capability link -> local decryption -> recipient agent`

The following are architectural/product constraints:

1. AgentShare must not require an AgentShare account, workspace, or organization
   membership for the core share/open flow.
2. Possession of the complete capability link authorizes access until expiry or
   revocation. The link is therefore a secret.
3. The normal relay path must not require conversation plaintext or the
   encryption key.
4. The Agent Context Bundle is the interoperability boundary. Codex and Claude
   Code are adapters to that boundary, not the permanent scope of the protocol.
5. The project, protocol, and infrastructure implementation remain open source
   and the intended public experience remains free to use, subject to reasonable
   shared-infrastructure anti-abuse and capacity limits.
6. The official relay is transport infrastructure, not a permanent team
   knowledge base.
7. Features should preserve explicit creator review and avoid silently expanding
   workspace access.
8. Self-hosting and third-party compatible implementations are legitimate parts
   of the ecosystem rather than enterprise-only escape hatches.

## Consequences

Near-term roadmap work should prefer additional agent adapters, ACB evolution,
portable/self-hostable infrastructure, safe resource selection, and
lower-friction link handoff UX over team dashboards, billing, seat management,
or centralized transcript search.

Documentation should distinguish the current implementation from the long-term
agent-agnostic direction. Claims must not imply that unsupported agents work
today.

Capability sharing intentionally crosses company boundaries without a central
identity decision. This improves portability but means link leakage is an access
leak. Expiration, revocation, secret handling, creator review, and endpoint
security remain essential.

The recipient's chosen model provider is outside the blind-relay guarantee: once
the recipient decrypts locally and asks its agent a question, selected evidence
may be sent to that provider under the recipient's account and terms.

## Non-goals

This ADR does not forbid third parties from building accounts, durable archives,
search, or organization policy on top of AgentShare-compatible context. It says
those features are not prerequisites for the core AgentShare transport and
should not force the base protocol to become a proprietary SaaS control plane.

See [`../VISION.md`](../VISION.md) for the project-level statement of these
principles.
