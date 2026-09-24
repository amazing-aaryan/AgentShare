# v0.3.14: connection-first setup

This candidate includes the v0.3.13 native creator and first-time recipient
fixes. Codex users can connect the pinned CLI package as an MCP server without a
separate manual global CLI installation. At first use, `setup_agentshare` checks
whether the pinned global CLI and managed host skills are current. If needed, it
asks through a native Install/Cancel form before installing the CLI and writing
six Codex and Claude skill files. Cancel, unsupported forms, and incomplete
responses write nothing. The connected MCP tools can be used in the same
session; newly installed skills are available to future sessions.

When a first-time recipient pastes a link, the handoff page tells their agent to
explain the pinned global CLI download and obtain approval before installing.
The agent then attaches the link and can answer questions in that session. The
page's setup metadata is reachable without the relay query.

The MCP launch command necessarily downloads the pinned CLI into npm's cache
before a local MCP process can connect. The native first-use choice controls its
global installation and host integration files. Node.js 22+, a supported
authenticated agent, and Codex interactive permissions remain required.

This file tracks candidate behavior. Record build, test, package, live host,
release, and public deployment evidence separately before claiming general
readiness. Human native form use and real Claude handoff remain acceptance
gates.
