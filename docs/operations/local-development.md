# Local Development

## Prerequisites

- Node.js 22 or newer
- Authenticated Codex CLI and/or Claude Code CLI

## Start

```powershell
npm ci
npm run build
npm run start:relay
```

The development relay listens on `http://127.0.0.1:8787` and stores shares in
memory. Restarting it deletes every share.

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

## Recipient

```powershell
agentshare open --target codex
```

Enter the link at the hidden prompt. `/exit` ends the REPL. AgentShare retains
the eight most recent user/assistant turns in memory for follow-up continuity.
Each Codex model process still runs with ephemeral state, ignored user
config/rules, no shell, unified exec, patch, JavaScript, or code-mode tools,
deny-all configured filesystem access, disabled network, web search, apps,
hooks, plugins, and memories. Claude runs with no built-in tools, strict empty
MCP config, no settings sources, no Chrome, no skills, and no session
persistence.

## Remaining Beta Work

- Publish `agentshare` to npm; current installs use GitHub release assets.
- Complete current-version authenticated recipient smoke tests on each release.
- Continue independent security review as the threat model and supported hosts evolve.

Cross-platform CI is an existing release gate; repository-level security controls are documented in [`repository-security.md`](repository-security.md).
