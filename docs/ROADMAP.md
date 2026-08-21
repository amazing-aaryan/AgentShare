# AgentShare Roadmap

This roadmap translates [`VISION.md`](VISION.md) into implementation priorities.
It is directional rather than a release promise.

## North Star

Make this flow feel ordinary:

**select context -> review -> send one link -> recipient chooses an agent -> continue**

Do it without requiring AgentShare accounts, shared organizations, paid access,
or a relay that receives the share plaintext or encryption key.

## Priority 1: Perfect the Link Handoff

Reduce friction in the existing Codex/Claude path while preserving the security
boundary.

Focus areas:

- shorten the steps between receiving a link and opening the isolated target
  agent;
- make current recipient requirements and unsupported-version failures obvious;
- improve copy/paste and terminal UX without exposing the complete capability in
  arguments, logs, history, or analytics;
- make expiry, revocation, reuse, and `--new` behavior easy to understand;
- keep creator review explicit and comprehensible for text and resources.

Success means an indie hacker can send a link to someone who has never used
AgentShare and that recipient can understand what it is and continue safely.

## Priority 2: Make ACB a Stronger Interoperability Boundary

Evolve Agent Context Bundle deliberately as real cross-agent needs appear.

Potential areas:

- clearer representation of decisions and unresolved questions;
- richer provenance for tool evidence and file-derived facts;
- explicit resource relationships without implicit workspace crawling;
- compatibility rules for additive fields and future versions;
- import/export fixtures for third-party implementers;
- conformance tests independent from the official relay.

Avoid turning ACB into a dump of every host-specific internal field. The format
should represent portable working context, not reproduce a proprietary session
database.

## Priority 3: Broaden Agent Adapters

Current first-class adapters are Codex and Claude Code. Add new agents when both
creator extraction and recipient isolation can meet the project contract.

Likely candidates should be prioritized by real user demand, such as Cursor,
Gemini CLI, OpenCode, VS Code/Copilot-compatible flows, and other agent harnesses
that expose sufficient safe integration surfaces.

Every new adapter must:

- map selected context into ACB;
- preserve explicit sender review;
- avoid unrelated workspace access;
- use the recipient's own provider authentication;
- prevent capability leakage;
- prove recipient isolation on exact supported releases;
- fail closed when host capabilities drift.

"Agent-agnostic" is a compatibility goal, not permission to support an unsafe
host configuration.

## Priority 4: Make Self-hosting Boring

The official free public service should be the easiest default, not a proprietary
requirement.

Improve:

- documented deployment contracts;
- reproducible relay/handoff deployment;
- clear separation between protocol requirements and public-relay policy;
- local conformance tests for compatible relays;
- simple configuration of alternate relay origins;
- upgrade/rollback documentation that preserves existing shares where possible.

Longer term, a very small deployment experience such as a documented one-command
or one-config path is preferable to an enterprise-oriented setup guide.

## Priority 5: Richer Sharing Without Accounts

Add useful capability semantics only when they retain the simple link model.
Possible examples include:

- easier TTL selection;
- clearer one-off/fresh-share creation;
- safer explicit resource inclusion/exclusion;
- additional local preview and redaction controls;
- protocol-compatible capability variants if a concrete use case justifies
  them.

Do not introduce mandatory identity, company workspaces, or seat management to
solve problems that capability semantics can solve more simply.

## Priority 6: Keep the Free Public Service Sustainable

"Free forever" does not mean pretending shared infrastructure has infinite
capacity. Keep the official service usable through transparent technical limits
rather than monetization.

Preferred controls:

- bounded TTLs and ciphertext size;
- rate limits;
- per-source and global active-share capacity;
- fast cleanup of abandoned reservations and expired ciphertext;
- efficient storage formats and operations;
- optional compatible self-hosting when users need different limits.

Avoid paid tiers, ad-driven tracking, selling share data, or requiring accounts
as an abuse-control shortcut.

## Priority 7: Grow Beyond Coding Without Losing the Core

Coding agents are the current beachhead because their sessions already contain
valuable working state and users frequently hand tasks between people.

The protocol should remain general enough that future research, design,
analysis, data, or other agent systems can exchange useful context through ACB
when safe adapters exist.

Do not prematurely build vertical product features for every agent category.
First make the context and transport boundaries genuinely reusable.

## Explicit Non-priorities

The base AgentShare project should not spend roadmap effort on:

- subscriptions or monetization;
- enterprise seat management;
- mandatory SSO/SCIM;
- a Slack replacement;
- a permanent company transcript database;
- organization-wide semantic search over plaintext sessions;
- employee/agent productivity analytics;
- a social network for AI sessions;
- a proprietary model/agent runtime.

Third parties may build those products on compatible open formats if they want
them.

## Decision Test

Before adding a roadmap item, ask:

1. Does it make it easier to give useful AI context to another person, machine,
   or agent?
2. Does it preserve sender review?
3. Can the transport remain blind to share plaintext/key material?
4. Can the core flow remain account-free and usable across organization
   boundaries?
5. Does it strengthen open interoperability rather than vendor lock-in?
6. Can the project remain completely free to use?

If several answers are no, it probably belongs outside AgentShare's base
project.
