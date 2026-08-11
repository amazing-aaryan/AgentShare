# AgentShare CLI

Encrypted Codex and Claude context handoff.

```sh
npm install --global https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.2/agentshare-0.1.2.tgz
agentshare init
agentshare share --current --source codex
```

```sh
npm exec --yes --package=https://github.com/amazing-aaryan/AgentShare/releases/download/v0.1.2/agentshare-0.1.2.tgz -- agentshare open --target codex
```

The connector asks for the capability link using hidden terminal input. Never
place AgentShare links in command arguments or environment variables.

Requires Node.js 22 or newer. Apache-2.0.
