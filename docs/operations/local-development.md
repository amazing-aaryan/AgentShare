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

Enter the link at the hidden prompt. `/exit` ends the REPL. Each Codex query
runs with ephemeral state, ignored user config/rules, all discovered user skills
disabled, deny-all filesystem access, disabled network, web search, apps, hooks,
and memories. Claude runs with no built-in tools, strict empty MCP config, no
settings sources, no Chrome, no skills, and no session persistence.

## Release Blockers

- Replace in-memory relay with durable expiring D1/R2 or equivalent storage.
- Publish `agentshare` to npm and update the pinned share-page version.
- Deploy relay/page on HTTPS with access-log redaction and retention controls.
- Complete current-version Claude OAuth and launcher smoke tests.
- Run external security review and full cross-platform CI.
