# AgentShare CLI

Encrypted Codex and Claude Code context handoff.

Requires Node.js 22 or newer.

```sh
npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.10/agentshare-0.1.10.tgz
agentshare init
```

Start a new agent session, then invoke `$agentshare` in Codex or `/share` in
Claude Code. Before a new upload, AgentShare shows all normalized text content
exactly after redaction. Binary resources, when present, are not printed
byte-for-byte; they are inventoried by media type, byte length, and SHA-256 and
are scanned for suspected secrets in supported text views. Review and approve
before sending the resulting link.

Recipients may run the connector without a global installation:

```sh
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.10/agentshare-0.1.10.tgz -- agentshare open --target codex
```

The connector requests the capability link through hidden terminal input. New
v0.1.10 links use the independent AgentShare handoff origin while the encrypted
blob remains on the selected relay. Use `--target claude` for Claude Code. See
the [full guide](https://github.com/amazing-aaryan/AgentShare#readme).

Apache-2.0.
