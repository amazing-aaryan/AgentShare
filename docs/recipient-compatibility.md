# Recipient compatibility evidence

AgentShare's long-term goal is agent-agnostic context transport, but **agent
agnostic does not mean every agent is trusted today**. A recipient target is
supported only when its launcher profile can preserve the isolation contract
required to consume untrusted shared context safely.

The open interoperability boundary is the Agent Context Bundle; current
first-class recipient adapters are Codex and Claude Code. New target adapters
should expand portability without weakening the fail-closed recipient boundary.
See [`VISION.md`](VISION.md) and [ADR 0005](adr/0005-open-context-transport.md).

## Current compatibility policy

Codex and Claude Code use different compatibility policies because their current
launcher surfaces have different stability characteristics.

### Codex

AgentShare accepts a recognizable **Codex CLI 0.145.0 or newer** instead of
requiring every future Codex release to be added to an exact-version allowlist.
The minimum version is only the first gate. Before every recipient launch,
AgentShare also requires `codex exec --help` to advertise the isolation controls
its production launcher depends on:

- `--ephemeral`;
- `--ignore-user-config`;
- `--ignore-rules`;
- `--strict-config`;
- `--skip-git-repo-check`;
- `--cd`;
- `--config`.

If the version is older than 0.145.0, the version output is unrecognized, or any
required control disappears, AgentShare fails closed before launching the
recipient agent. The production launcher still forces its restrictive config,
and Codex itself may additionally refuse startup when the host platform cannot
enforce the requested sandbox. AgentShare does not weaken that refusal to make a
newer version run.

This policy avoids making routine Codex upgrades unusable merely because their
version number changed. It is not a claim that a version number alone proves
future sandbox semantics. Historical real-host isolation evidence remains the
baseline, capability drift is checked at runtime, and known regressions can be
blocked explicitly if evidence requires it.

The v2 collaboration MCP runtime is narrower: its native approval path is
currently reviewed only against Codex CLI `0.147.0`, so that specific runtime
continues to fail closed on other Codex versions until equivalent native MCP
approval evidence is recorded.

### Claude Code

Claude Code remains on the exact-reviewed release policy for now. An unreviewed
Claude Code version is rejected even if its help output resembles a reviewed
release.

## Why recipient isolation matters

A capability link is intentionally portable and may come from someone outside
the recipient's company, workspace, or trust domain. The recipient process must
therefore treat the shared context as untrusted input and must not inherit broad
project filesystem, shell, network, plugin, or user-customization capabilities
just because the link is valid.

This security requirement is a core part of cross-boundary sharing. Supporting a
popular agent without preserving isolation would make the open protocol easier
to integrate but less safe to use.

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

Claude Code 2.1.230 was not published. Earlier release evidence for Codex
0.145.0 and Claude 2.1.210 is also recorded in
[`releases/v0.1.8-release-verification.md`](releases/v0.1.8-release-verification.md).

## 2026-08-21 current-release review

Environment: Windows NT 10.0.26200.0, Node.js 24.14.0. Exact published binaries
were installed into isolated npm prefixes. Capability help checks passed for
both hosts before the real production launcher tests.

| Host        | Release | Filesystem           | Network              | Two-turn dialogue | Result                 |
| ----------- | ------- | -------------------- | -------------------- | ----------------- | ---------------------- |
| Codex CLI   | 0.149.0 | Safe startup refusal | Safe startup refusal | Fail              | Platform refusal, safe |
| Claude Code | 2.1.238 | Pass                 | Pass                 | Pass              | Exact-reviewed         |

Codex CLI 0.149.0 refused to start under AgentShare's required Windows sandbox:
`windows unelevated restricted-token sandbox cannot enforce split filesystem read restrictions directly; refusing to run unsandboxed`.
That is a safe platform/runtime refusal. Under the current
minimum-plus-capability policy, the version number alone no longer blocks
0.149.0, but AgentShare still does not bypass a Codex refusal when the requested
isolation cannot be enforced. Claude Code 2.1.238 denied filesystem/network
attempts and preserved grounded two-turn answers, so that exact release remains
in the Claude reviewed allowlist.

## 2026-08-29 Codex capability probe

The current published Codex CLI `0.151.0` was installed on an Ubuntu 24.04
GitHub runner with Node.js 24. Its real `codex --version` output was recognized,
and `codex exec --help` advertised every required AgentShare isolation option
listed above. The probe therefore passed the same version/capability preflight
used by AgentShare.

This was a launcher-surface compatibility probe, not an authenticated model
isolation test. Real filesystem/network behavior remains covered by historical
review evidence and by authenticated release/security checks when those are run.

## Review procedure

For Codex compatibility changes:

1. Confirm the minimum known-safe baseline remains justified.
2. Install a current published release and confirm the binary's own version.
3. Run the launcher capability preflight and fail closed on missing controls.
4. When sandbox behavior changes or a regression is suspected, execute the real
   filesystem and controlled-network attempts through `runTarget`.
5. Confirm capability URLs and keys remain absent from process arguments and
   inherited environment.
6. Add an explicit blocked version/range only when evidence demonstrates a
   regression that cannot be detected by the existing capability/runtime gates.

For Claude Code, continue the exact-release review before adding a version to
the reviewed allowlist: run the capability preflight, real filesystem/network
tests, and representative dialogue checks.

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
host isolation still requires authenticated CLIs when a release or security
review calls for it.

## v0.3.0 evidence scope: `codex-only-v1`

This is an explicit, narrow release evidence profile, not an expansion of the
general Codex compatibility policy or a claim that v0.3.0 has passed. Its exact
runtime is Windows build 26200 (`win32`, `10.0.26200`), Node.js `24.14.0`, Codex
CLI `0.147.0`. Claude, other operating systems, other builds, and other
agent/runtime versions are outside this profile. Historical isolation rows above
do not prove the published v2 collaboration workflow.

The frozen inventory requires **both terminal and chat** creation paths, each
continuing through published-artifact bootstrap, actual MCP read, actual MCP
proposal/inbox delivery, explicit owner approval, refreshed revision retrieval,
revocation, isolation, and complete cleanup. Preloaded context or a successful
launcher exit cannot substitute for successful MCP calls. Any missing, skipped,
cancelled, failed, or incomplete check fails this profile.

`npm run test:release` without arguments retains the existing both-agent gate.
Those legacy source/launcher suites, including partial live diagnostics, are
**not promotable as full v2 evidence**. The explicit profile instead requires a
versioned report, independent candidate manifest, original published archive,
and local hashed evidence attachments. It performs offline validation only.

See [v0.3.0 release evidence contract](release-v0.3.0.md) for the frozen
inventory, exact report fields, commands, and outstanding real-flow integration.
A passing contract fixture is not a recipient compatibility result.
