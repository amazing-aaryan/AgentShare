# AgentShare CLI

Encrypted, revisioned agent collaboration for Codex and Claude Code.

Requires Node.js 22 or newer.

## Install

```sh
npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.2.0/agentshare-0.2.0.tgz
agentshare init
```

Start a new agent session so the host discovers the installed AgentShare skills.

## Share

In Codex invoke `$agentshare`. In Claude Code invoke `/share`.

AgentShare opens a selection-only terminal UI. Arrow keys and Enter choose:

- conversation + current project, conversation only, or project only;
- read + propose access or read-only access;
- 1 hour, 24 hours, or 72 hours.

The default is conversation + current project, read + propose, 24 hours. AgentShare scans and encrypts the selected environment locally, publishes ciphertext to the relay, and returns one `/e/` capability URL.

## Receive

Paste the full `/e/` URL into Codex or Claude Code. The handoff page exposes a machine-readable bootstrap contract so a fresh agent can install the pinned AgentShare release if needed. Once installed, the receiver skill runs `agentshare bootstrap`, attaches the encrypted environment, and delegates questions to a restricted AgentShare worker.

The recipient's normal agent does not receive a plaintext checkout of the sender's project. The child worker has only the local AgentShare MCP read/proposal tools and no shell, network, web, recipient project filesystem, user skills, plugins, or unrelated MCP servers.

## Proposals

A read + propose recipient can ask their agent to change the shared environment. AgentShare stages the requested edits in an in-memory proposal overlay and encrypts the proposal specifically to the creator. Nothing writes the creator's workspace until the creator reviews the diff and explicitly approves it.

The creator can invoke `$agentshare` or run `agentshare inbox --source codex|claude` to review pending proposals. Approval verifies the base revision and file hashes, rejects unsafe paths or suspected secrets, writes an encrypted rollback journal, applies the operations locally, and publishes the next encrypted environment revision. The original recipient link remains unchanged.

## Legacy v1 handoff

The v1 one-blob handoff remains available:

```sh
agentshare share-v1 --current --source codex
agentshare open --target codex
agentshare revoke
```

See the [full guide](https://github.com/amazing-aaryan/AgentShare#readme).

Apache-2.0.
