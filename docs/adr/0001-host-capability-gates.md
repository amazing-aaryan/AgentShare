# ADR 0001: Host Capability Gates

- Status: Superseded by ADR 0003
- Date: 2026-08-08
- Tested on: Windows 11, PowerShell

## Context

AgentShare v0 requires all of the following before implementation may be
scaffolded:

1. An exact creator `/share` command in current Codex and Claude Code.
2. Per-invocation MCP configuration without changing persistent user config.
3. A temporary recipient session exposing only AgentShare query tools, with no
   shell, browser, network, unrelated MCP, plugins, hooks, or writable files.
4. Existing host authentication remains usable.

## Tested Versions

```text
codex-cli 0.145.0
Claude Code 2.1.210
```

## Results

| Capability                    | Codex 0.145.0                | Claude Code 2.1.210                                |
| ----------------------------- | ---------------------------- | -------------------------------------------------- |
| Exact user-defined `/share`   | **Fail**                     | Pass via user-level skill                          |
| Temporary MCP config          | Pass via `-c mcp_servers...` | Pass via `--mcp-config` and `--strict-mcp-config`  |
| Disable built-in tools        | **Fail for interactive CLI** | Pass via `--tools` allowlist                       |
| Ignore persistent user config | **Fail for interactive CLI** | Pass via `--setting-sources` plus explicit flags   |
| Ephemeral session             | **Fail for interactive CLI** | Interactive history controls require further spike |

### Codex evidence

`codex plugin --help` exposes marketplace installation only. Plugins provide
skills, which use `$skill-name`; they do not register arbitrary slash commands.
OpenAI removed custom slash commands in Codex 0.117.0 and states that they will
not return: [openai/codex#15939](https://github.com/openai/codex/issues/15939),
[openai/codex#18857](https://github.com/openai/codex/issues/18857).

`codex --help` exposes read-only filesystem sandboxing, approval policy, and
per-invocation config overrides, but no built-in tool allowlist or
`--ignore-user-config`/`--ephemeral` options. Those isolation options exist only
on `codex exec`, as shown by `codex exec --help`. The current
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)
documents web-search and image-tool toggles but no switch that removes the
interactive shell tool.

Therefore an interactive Codex recipient can still load user customizations and
receive a shell tool. Read-only filesystem sandboxing is not equivalent to the
required query-only tool boundary.

### Claude evidence

Claude Code documents user-level skills as exact `/skill-name` commands. Plugin
skills are namespaced as `/plugin-name:skill-name`, so the exact `/share`
command must initially be a standalone user skill rather than a plugin:
[skills](https://code.claude.com/docs/en/slash-commands),
[plugins](https://code.claude.com/docs/en/plugins).

`claude --help` exposes `--mcp-config`, `--strict-mcp-config`, `--tools`,
`--disallowed-tools`, `--setting-sources`, `--disable-slash-commands`,
`--no-chrome`, and `--safe-mode`. These are sufficient to continue a disposable
Claude capability spike after the Codex scope decision.

## Decision

The original Step 1 contract does not pass. The user selected Option A on
2026-08-08; ADR 0003 defines the amended host contract.

## Scope Options

### Option A: Recommended

Keep Claude's exact `/share`. Use explicit `$agentshare` in Codex. Launch
recipients through an AgentShare terminal REPL backed by
`codex exec --ephemeral --ignore-user-config` or a strictly configured Claude
session. This preserves current-host support and the security boundary, but
Codex recipients do not see the native interactive Codex TUI.

### Option B

Keep native interactive Codex, accept read-only sandboxing plus prompt-level
query restrictions. This weakens the security claim because shell and user
customizations remain available. Not recommended.

### Option C

Ship Claude-to-Claude first. Add Codex when its interactive extension and tool
isolation surfaces exist. This preserves every security claim but drops the
cross-agent v0 requirement.

## Consequences

Option A is approved. Steps 2 through 15 may proceed against ADR 0003. The rest
of the architecture remains unchanged.
