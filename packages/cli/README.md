# AgentShare CLI

Encrypted Codex and Claude Code context handoff.

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

Recipients may run the connector without a global installation:

```sh
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.11/agentshare-0.1.11.tgz -- agentshare open --target codex
```

The connector requests the capability link through hidden terminal input. New
v0.1.10 links use the independent AgentShare handoff origin while the encrypted
blob remains on the selected relay. Use `--target claude` for Claude Code. See
the [full guide](https://github.com/amazing-aaryan/AgentShare#readme).

Apache-2.0.
