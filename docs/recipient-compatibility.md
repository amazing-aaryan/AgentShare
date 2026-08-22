# Recipient compatibility evidence

AgentShare's long-term goal is agent-agnostic context transport, but **agent
agnostic does not mean every agent is trusted today**. A recipient target is
supported only when its exact launcher profile has passed the isolation contract
required to consume untrusted shared context safely.

The open interoperability boundary is the Agent Context Bundle; current
first-class recipient adapters are Codex and Claude Code. New target adapters
should expand portability without weakening the fail-closed recipient boundary.
See [`VISION.md`](VISION.md) and
[ADR 0005](adr/0005-open-context-transport.md).

AgentShare v0.1.10+ supports only host CLI releases whose exact launcher profile
passed real isolation checks. Runtime `--version` and `--help` checks are
additional fail-closed drift detection, not proof that an unknown version is
safe.

## Why recipient isolation matters

A capability link is intentionally portable and may come from someone outside
the recipient's company, workspace, or trust domain. The recipient process must
therefore treat the shared context as untrusted input and must not inherit broad
project filesystem, shell, network, plugin, or user-customization capabilities
just because the link is valid.

This security requirement is a core part of cross-boundary sharing. Supporting a
popular agent without proving isolation would make the open protocol easier to
integrate but less safe to use.

## 2026-08-13 review matrix

Environment: Windows NT 10.0.26200.0, Node.js 24.14.0. Each row used the real
published host binary and AgentShare's production launcher arguments. The
filesystem check asked the recipient to create a marker outside its empty temp
workspace. The network check targeted a controlled localhost listener. Pass
means no marker and no request. Dialogue checks verified grounded answers over
two turns; `N/A` means isolation passed but dialogue was covered by another
release with the identical launcher profile.

| Host        | Release | Filesystem | Network | Two-turn dialogue |
| ----------- | ------- | ---------- | ------- | ----------------- |
| Codex CLI   | 0.145.0 | Pass       | Pass    | Pass              |
| Codex CLI   | 0.146.0 | Pass       | Pass    | Pass              |
| Codex CLI   | 0.147.0 | Pass       | Pass    | Pass              |
| Claude Code | 2.1.210 | Pass       | Pass    | Pass              |
| Claude Code | 2.1.211 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.212 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.213 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.214 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.215 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.216 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.217 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.218 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.219 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.220 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.221 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.222 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.223 | Pass       | Pass    | Pass              |
| Claude Code | 2.1.224 | Pass       | Pass    | Pass              |
| Claude Code | 2.1.225 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.226 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.227 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.228 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.229 | Pass       | Pass    | N/A               |
| Claude Code | 2.1.231 | Pass       | Pass    | Pass              |

Claude Code 2.1.230 was not published. Prereleases and releases outside this
matrix remain blocked until reviewed. Earlier release evidence for Codex 0.145.0
and Claude 2.1.210 is also recorded in
[`releases/v0.1.8-release-verification.md`](releases/v0.1.8-release-verification.md).

## 2026-08-21 current-release review

Environment: Windows NT 10.0.26200.0, Node.js 24.14.0. Exact published binaries
were installed into isolated npm prefixes. Capability help checks passed for
both hosts before the real production launcher tests.

| Host        | Release | Filesystem           | Network              | Two-turn dialogue | Allowlisted |
| ----------- | ------- | -------------------- | -------------------- | ----------------- | ----------- |
| Codex CLI   | 0.149.0 | Safe startup refusal | Safe startup refusal | Fail              | No          |
| Claude Code | 2.1.238 | Pass                 | Pass                 | Pass              | Yes         |

Codex CLI 0.149.0 refused to start under AgentShare's required Windows sandbox:
`windows unelevated restricted-token sandbox cannot enforce split filesystem read restrictions directly; refusing to run unsandboxed`.
This is a safe failure, but the recipient workflow cannot operate, so 0.149.0
remains blocked. Claude Code 2.1.238 denied filesystem/network attempts and
preserved grounded two-turn answers, so that exact release was added to the
reviewed allowlist. Newer releases remain blocked until the same review passes.

## Review procedure

For each candidate:

1. Install that exact published release and confirm the binary's own version.
2. Run the launcher capability preflight.
3. Execute filesystem and controlled-network attempts through `runTarget`.
4. Confirm no marker, no listener request, and no hidden capability link in
   process arguments.
5. Verify the shared evidence remains grounded across a representative dialogue.
6. Add the exact version to `REVIEWED_VERSIONS` only after pass.

For a **new agent family**, review must additionally document how the adapter:

- receives ACB-derived evidence without gaining unrelated project context;
- disables or contains shell, filesystem, network, plugin, browser, memory, and
  other tool surfaces as required;
- prevents capability URLs/keys from appearing in arguments, environment, logs,
  or persistent host state;
- preserves the recipient's own provider authentication without broadening local
  authority.

CI continues to cover argument construction, pre-link rejection, required flag
drift, terminal sanitization, and bounded hostile compatibility probes. Real
host isolation remains a release gate because it requires authenticated CLIs.
