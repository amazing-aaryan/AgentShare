# AgentShare CLI

Encrypted Codex and Claude Code context handoff.

Requires Node.js 22 or newer.

```sh
npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.6/agentshare-0.1.6.tgz
agentshare init
```

Start a new agent session, then invoke `$agentshare` in Codex or `/share` in
Claude Code. Review and approve the payload before sending the resulting link.

Recipients may run the connector without a global installation:

```sh
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.6/agentshare-0.1.6.tgz -- agentshare open --target codex
```

The connector requests the capability link through hidden terminal input. Use
`--target claude` for Claude Code. See the
[full guide](https://github.com/amazing-aaryan/AgentShare#readme).

Apache-2.0.
