# AgentShare CLI

Encrypted Codex and Claude context handoff.

```sh
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.0/agentshare-0.1.0.tgz -- agentshare open --target codex
```

The connector asks for the capability link using hidden terminal input. Never
place AgentShare links in command arguments or environment variables.

Requires Node.js 22 or newer. Apache-2.0.
