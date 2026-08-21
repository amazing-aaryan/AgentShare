# AgentShare CLI

**Free, open, review-before-send AI context handoff by capability link.**

AgentShare lets you select useful context from a supported agent, review what
will cross the boundary, encrypt it locally, and send one link to another person
or machine. The recipient does not need an AgentShare account, shared workspace,
or company membership.

The official relay transports ciphertext and does not receive conversation
plaintext or the encryption key. The complete link is the bearer access
capability, so treat it as a secret.

Current first-class host integrations are Codex and Claude Code. The broader
project direction is agent-agnostic through the open Agent Context Bundle rather
than through a proprietary server-side session store.

Requires Node.js 22 or newer.

```sh
npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.11/agentshare-0.1.11.tgz
agentshare init
```

Start a new agent session, then invoke `$agentshare` in Codex or `/share` in
Claude Code. Before a new upload, AgentShare shows all normalized text content
exactly after redaction. Binary resources, when present, are not printed
byte-for-byte; they are inventoried by media type, byte length, and SHA-256 and
are scanned for suspected secrets in supported text views. Review and approve
before sending the resulting link.

## Open a handoff

Recipients may run the connector without a global installation or AgentShare
signup:

```sh
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.11/agentshare-0.1.11.tgz -- agentshare open --target codex
```

The connector requests the complete capability link through hidden terminal
input. Use `--target claude` for Claude Code.

New-format links use an independent AgentShare handoff origin while the
encrypted blob remains on the selected relay. Decryption happens locally. Once
the recipient asks its chosen agent a question, selected decrypted evidence may
be sent to that model provider under the recipient's own account and terms.

## Updates

Check the canonical AgentShare GitHub release and install a newer stable release
with:

```sh
agentshare update --check
agentshare update
```

Successful creator commands perform a best-effort release check at most once per
24 hours and write any update notice to stderr. They never install an update
silently. Set `AGENTSHARE_NO_UPDATE_CHECK=1` to disable passive checks; explicit
`agentshare update --check` and `agentshare update` still work.

The updater accepts only exact stable `vMAJOR.MINOR.PATCH` releases from
`amazing-aaryan/AgentShare`, derives the immutable release tarball URL locally,
and verifies the newly installed CLI version before running `agentshare repair`
from that new installation. AgentShare-managed Codex and Claude skills are
refreshed; unmanaged conflicting skills are not overwritten.

The pinned `npm install --global ...` command remains the manual recovery path
if an update cannot be completed automatically.

## Project principles

AgentShare is intended to remain:

- free to use rather than freemium;
- open source and self-hostable;
- account-free for the core share/open flow;
- capability-based across organizational boundaries;
- blind at the relay content boundary;
- explicit about creator review;
- portable across more agent vendors over time.

See the [full guide](https://github.com/amazing-aaryan/AgentShare#readme) and
[`docs/VISION.md`](https://github.com/amazing-aaryan/AgentShare/blob/master/docs/VISION.md).

Apache-2.0.
