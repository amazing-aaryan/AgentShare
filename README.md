# AgentShare

Send encrypted coding-agent context to a coworker's Codex or Claude session.

AgentShare packages selected context into a deterministic Agent Context Bundle
(ACB), scans and reviews the final plaintext, encrypts it locally, and uploads
only ciphertext to a blind relay. The recipient opens the capability link using
a temporary query-only connector.

## Status

Release-ready MVP. Current build includes Codex and Claude transcript adapters,
final-payload review and secret redaction, deterministic ACB encoding, local
AES-256-GCM encryption, blind relay APIs, idempotent sharing, revocation, a
recipient page, global creator skills, isolated recipient launchers, and a
SQLite-backed Cloudflare Durable Object relay.

The in-memory relay is for local development. The edge relay passes local
create/upload/download/revoke tests and Cloudflare's deployment dry run. A
permanent public endpoint still requires an authenticated Cloudflare account. Do
not use with production secrets before an independent security review.

## Development

Requires Node.js 22 or newer.

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run start:relay
```

In another terminal:

```powershell
npm install --global ./packages/cli
agentshare init
agentshare share --current --source codex --relay http://127.0.0.1:8787
```

Codex creators invoke `$agentshare`; Claude Code creators invoke `/share`. A
recipient opens the link, copies the version-pinned connector command, runs it,
then enters the original link through hidden terminal input.

```powershell
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.0/agentshare-0.1.0.tgz -- agentshare open --target codex
```

This version-pinned command installs the CLI from the public GitHub release.
Browsers cannot securely launch an uninstalled CLI, so AgentShare avoids custom
protocol links that would expose capability material in process arguments.

Creators can select a hosted relay with `--relay URL` or the `AGENTSHARE_RELAY`
environment variable.

See [the reviewed blueprint](plans/agentshare-v0-blueprint.md) and
[host capability ADR](docs/adr/0001-host-capability-gates.md).

## License

Apache-2.0.
