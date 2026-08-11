# AgentShare

Send encrypted coding-agent context to a coworker's Codex or Claude Code
session. AgentShare reviews and encrypts context locally; the public relay sees
only ciphertext.

## Requirements

- Node.js 22 or newer
- Codex CLI or Claude Code
- A terminal where your AI agent may run approved commands

AgentShare is a public beta. Do not share production credentials, regulated
data, or other high-risk material before an independent security review.

## Let Your AI Agent Install It

Paste this message into Codex or Claude Code:

```text
Install AgentShare v0.1.7 from its immutable GitHub release.

1. Confirm Node.js 22 or newer is installed.
2. Run:
   npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.7/agentshare-0.1.7.tgz
3. Run:
   agentshare init
4. Run `agentshare` and confirm the CLI usage appears.
5. Do not share any context yet. Tell me which integration files were installed and remind me to start a new agent session.
```

`agentshare init` installs an explicit creator skill for both supported hosts.
Start a new Codex or Claude Code session afterward so the host discovers it.

## Manual Installation

```powershell
npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.7/agentshare-0.1.7.tgz
agentshare init
agentshare
```

Expected creator commands:

| Host        | Command       |
| ----------- | ------------- |
| Codex       | `$agentshare` |
| Claude Code | `/share`      |

These commands are explicit-only. AgentShare does not share a session unless you
invoke one of them and approve the reviewed payload.

## Create a Share Link

1. Open the Codex or Claude Code session containing the context.
2. Type `$agentshare` in Codex or `/share` in Claude Code.
3. Review the normalized context, redactions, fingerprint, expiry, and size.
4. Approve the terminal prompt.
5. Send the resulting capability link to your coworker.

If the skill is unavailable, use the CLI directly:

```powershell
agentshare share --current --source codex
```

For Claude Code, replace `codex` with `claude`.

## Open a Coworker's Link

The recipient does not need to install AgentShare globally.

1. Open the capability link in a browser.
2. Choose Codex or Claude Code.
3. Copy and run the version-pinned command shown on the page.
4. Copy the secure link and paste it into the hidden terminal prompt.
5. Ask questions in the isolated agent session that opens.

If browser policy blocks clipboard access, AgentShare reveals and selects the
secure link. Press `Ctrl+C` or `Cmd+C`, then paste it into the terminal prompt.

Equivalent Codex command:

```powershell
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.7/agentshare-0.1.7.tgz -- agentshare open --target codex
```

Replace `codex` with `claude` to open Claude Code.

## Update or Remove

Update by installing the newer immutable release and repairing integrations:

```powershell
npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.7/agentshare-0.1.7.tgz
agentshare repair
```

Remove integrations and the CLI:

```powershell
agentshare remove
npm uninstall --global agentshare
```

## How It Works

AgentShare packages selected context into a deterministic Agent Context Bundle
(ACB), scans and reviews the final plaintext, encrypts it locally with
AES-256-GCM, and uploads only ciphertext to a blind relay. Capability keys stay
in the URL fragment and never reach the relay. Shares support expiry,
idempotency, and revocation.

The complete selected normalized transcript is transferred inside the encrypted
bundle. Recipient questions use local lexical retrieval to select relevant
excerpts for the isolated target model. The AgentShare REPL retains the eight
most recent user/assistant turns for follow-up continuity; each underlying Codex
or Claude process remains ephemeral and receives no relay capability.

The public relay is `https://agentshare-relay.carnation-vermicelli.workers.dev`.
Creators can override it with `--relay URL` or `AGENTSHARE_RELAY`.

## Development

```powershell
npm ci
npm run format:check
npm run lint
npm run build
npm run test:coverage
npm run test:package
npm run test:edge-runtime
npm audit --audit-level=high
```

For local relay development:

```powershell
npm run start:relay
agentshare share --current --source codex --relay http://127.0.0.1:8787
```

See the [reviewed blueprint](plans/agentshare-v0-blueprint.md),
[host capability ADR](docs/adr/0001-host-capability-gates.md),
[contribution guide](CONTRIBUTING.md), and [security policy](SECURITY.md).

## License

[Apache-2.0](LICENSE).
