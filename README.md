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

The in-memory relay is for local development. The durable production relay is
live at `https://agentshare-relay.carnation-vermicelli.workers.dev`. It stores
only encrypted payloads and capability digests. The service is a public beta; do
not share production credentials or regulated data before an independent
security review.

## Development

Requires Node.js 22 or newer.

Install the public CLI and creator integrations:

```powershell
npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.5/agentshare-0.1.5.tgz
agentshare init
agentshare share --current --source codex
```

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
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.5/agentshare-0.1.5.tgz -- agentshare open --target codex
```

This version-pinned command installs the CLI from an immutable public GitHub
release. Browsers cannot securely launch an uninstalled CLI, so AgentShare
avoids custom protocol links that would expose capability material in process
arguments.

The public relay is the default. Creators can override it with `--relay URL` or
the `AGENTSHARE_RELAY` environment variable.

See [the reviewed blueprint](plans/agentshare-v0-blueprint.md),
[host capability ADR](docs/adr/0001-host-capability-gates.md), and
[contribution guide](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).
