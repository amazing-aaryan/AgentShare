# AgentShare Vision

## The open protocol for handing AI context to anyone

AgentShare exists to make one action ordinary:

> Give the useful context from one AI session to another person, machine, or
> agent by sending a link.

The sender chooses what to share, reviews the exact normalized/redacted text and
resource inventory, and approves the handoff. AgentShare encrypts the context on
the sender's device. The public relay transports ciphertext; it does not receive
the conversation plaintext or encryption key. A recipient who has the complete
capability link can decrypt locally and continue with a supported agent.

Today the first-class host adapters are Codex and Claude Code. The long-term
unit of interoperability is not a Codex session or a Claude session: it is an
**Agent Context Bundle (ACB)**. New agents should integrate by importing and
exporting that open context format rather than creating new closed silos.

## Why AgentShare exists

AI work increasingly contains state that is not captured by the final files:
failed approaches, decisions, constraints, discoveries, unresolved questions,
and the conversation that led to the current result. Git can move code state,
but another person or agent can still spend substantial time reconstructing the
working state that produced it.

AgentShare moves that working context directly.

The target users are not limited to coworkers inside one company. A handoff may
be between cofounders, indie hackers, open-source contributors, consultants and
clients, friends, researchers, two machines owned by one person, or two agents
from different vendors. AgentShare should not require those participants to
share an employer, Slack workspace, identity provider, subscription, or even an
AgentShare account.

## Product principles

### 1. Free forever

AgentShare is not a freemium product and has no paid tier as a goal. The client,
protocol, and official public handoff path are intended to remain usable without
a subscription or account. Public infrastructure may enforce reasonable
anti-abuse, capacity, and lifetime limits so that a free shared service remains
operable.

### 2. Open source forever

The pieces required to understand, audit, interoperate with, and self-host
AgentShare should remain open source. The project uses Apache-2.0. A user should
not be trapped if the official public infrastructure disappears: the protocol,
context format, and deployable relay/handoff implementation must remain
available.

### 3. No accounts and no organization boundary

AgentShare authorization is capability-based. The complete link is the access
credential. The service does not need an AgentShare identity, workspace, team,
seat, invite, or organization membership to decide whether two people are
allowed to collaborate.

This is intentionally cross-organization and cross-enterprise. Anyone can share
with anyone they deliberately give the complete link to.

The tradeoff is equally explicit: anyone who obtains the complete link can use
it until it expires or is revoked. Treat the complete link as a secret.

### 4. The transport must not need the plaintext

AgentShare should not become a database of everybody's AI work. Encryption and
decryption happen on client devices. The relay should only need the minimum
ciphertext, capability digests, integrity metadata, timestamps, size data, and
status required to deliver and expire a share.

This is stronger than promising not to inspect content. The normal relay design
should not possess the encryption key required to read it.

The recipient's chosen model provider can still receive the evidence excerpts
that the recipient locally decrypts and submits through that provider's CLI.
AgentShare does not claim to hide content from the model provider the recipient
chooses to use.

### 5. Review before send

The sender must remain in control of the boundary. AgentShare should show the
final normalized/redacted text exactly and inventory non-text resources before
upload. Secret scanning is an additional defense, not a substitute for sender
review.

Adding convenience must not quietly expand what AgentShare reads from a
workspace or uploads on the sender's behalf.

### 6. Agent-agnostic by design

Codex and Claude Code are current adapters, not the definition of the product.
AgentShare should grow toward a portable context layer that can bridge whichever
agents people actually use. Adapters translate host-specific sessions into the
open ACB representation and translate selected ACB evidence into a safely
isolated recipient session.

### 7. A link is the primary collaboration primitive

The core flow should stay small:

1. Select context.
2. Review it.
3. Approve it.
4. Send one capability link.
5. The recipient chooses a supported agent and continues.

Accounts, dashboards, permanent team archives, seat management, and company
workspaces are not prerequisites for this flow.

### 8. Ephemeral by default, portable by protocol

The official relay is a transport, not an organizational memory system. Shares
expire and can be revoked. Recipient working state is ephemeral. Long-lived
knowledge bases and searchable company transcript archives are different
products with different trust models.

At the same time, the protocol and ACB format should be portable enough for
other open tools to build compatible storage, routing, or agent adapters if they
want different lifecycle semantics.

## What AgentShare is not

AgentShare is not trying to become:

- a team chat product;
- a social network for AI sessions;
- an enterprise seat-management system;
- a permanent transcript warehouse;
- an employee-monitoring or agent-analytics product;
- a project-management system;
- a proprietary agent runtime;
- a monetized gate around context portability.

Those products can exist and can consume or produce AgentShare context. They do
not need to become part of AgentShare itself.

## Current implementation versus destination

Current public-beta behavior is deliberately narrower than the vision:

- creator adapters: Codex and Claude Code;
- recipient targets: reviewed Codex and Claude Code releases;
- explicit generic text-file sharing is also supported;
- the public relay has finite TTL, bundle-size, rate, and capacity limits;
- all holders of one link currently share the same bearer read capability;
- recipient target processes are isolated and ephemeral;
- the ACB and blind-relay protocols are versioned and documented in this repo.

Future work should prioritize broader adapters, a more portable context schema,
easier self-hosting, safer resource selection, and simpler link-to-agent UX while
preserving the principles above.

## Decision filter

When considering a feature, prefer the option that makes this sentence more
true:

> **AgentShare lets you give an AI's useful context to anyone, through an open
> and free protocol, without requiring the transport intermediary to receive the
> plaintext.**

A feature that requires central plaintext indexing, mandatory accounts,
organization membership, paid access, or vendor lock-in should face a very high
bar because it conflicts with the reason AgentShare exists.
