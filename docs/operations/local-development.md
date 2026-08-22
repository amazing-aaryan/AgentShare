# Local Development

Local development should preserve the same product boundary as production:
AgentShare is an open context transport, not an account/workspace service. The
local relay is useful both for development and as proof that the protocol does
not depend on the official hosted relay.

Read [`../VISION.md`](../VISION.md) before designing new host adapters or service
state.

## Prerequisites

- Node.js 22 or newer
- Authenticated Codex CLI and/or Claude Code CLI for current recipient testing

## Start

```powershell
npm ci
npm run build
npm run start:relay
```

The development relay listens on `http://127.0.0.1:8787` and stores shares in
memory. Restarting it deletes every share.

The relay does not create user accounts or organization state. It implements the
same capability-oriented transport semantics over local development storage.

Install the local bundled CLI and creator integrations:

```powershell
npm install --global ./packages/cli
agentshare init
```

New Codex sessions expose `$agentshare`. New Claude Code sessions expose
`/share`. Repair and removal are idempotent:

```powershell
agentshare repair
agentshare remove
```

## Manual Share

```powershell
agentshare share tests/fixtures/smoke-session.md --relay http://127.0.0.1:8787
```

The CLI shows the complete normalized plaintext, redactions, and fingerprint;
then separately shows server-authoritative expiry and limits. Upload occurs only
after both confirmations.

This creator-review boundary is part of the product contract. New adapters must
not silently crawl unrelated workspace content to make sharing more convenient.

## Recipient

```powershell
agentshare open --target codex
```

Enter the complete capability link at the hidden prompt. No AgentShare account
or workspace membership is required. `/exit` ends the REPL.

AgentShare retains the eight most recent user/assistant turns in memory for
follow-up continuity. Each Codex model process still runs with ephemeral state,
ignored user config/rules, no shell, unified exec, patch, JavaScript, or
code-mode tools, deny-all configured filesystem access, disabled network, web
search, apps, hooks, plugins, and memories. Claude runs with no built-in tools,
strict empty MCP config, no settings sources, no Chrome, no skills, and no
session persistence.

## Developing New Agent Adapters

AgentShare aims to become agent-agnostic through adapters, not through a weaker
security boundary.

A creator adapter should:

1. identify only the intended source session/context;
2. normalize it into the open Agent Context Bundle representation;
3. preserve source/provenance identifiers;
4. feed the normal scanner and exact review flow;
5. avoid reading unrelated project state unless the user explicitly selects it.

A recipient adapter should:

1. consume locally decrypted ACB-derived evidence;
2. use the recipient's own provider authentication;
3. prevent the target agent from inheriting unrelated filesystem, shell,
   network, browser, plugin, memory, or host powers;
4. keep capability URLs and keys out of arguments, environment variables,
   logs, and persistent sessions;
5. receive real compatibility/isolation review before an exact version becomes
   supported.

The current evidence process is documented in
[`../recipient-compatibility.md`](../recipient-compatibility.md).

## Open-protocol testing

When possible, tests should target protocol/ACB behavior independently from the
official Cloudflare deployment. The official relay is one free public
implementation; compatible self-hosted implementations are a supported design
goal.

Protocol behavior is documented in [`../protocol/`](../protocol/).

## Remaining Beta Work

- Publish `agentshare` to npm; current installs use GitHub release assets.
- Complete current-version authenticated recipient smoke tests on each release.
- Continue independent security review as the threat model and supported hosts
  evolve.
- Reduce friction between receiving a link and opening it in the recipient's
  chosen supported agent.
- Broaden host adapters only when the review and isolation contracts can be
  preserved.

Cross-platform CI is an existing release gate; repository-level security
controls are documented in [`repository-security.md`](repository-security.md).
