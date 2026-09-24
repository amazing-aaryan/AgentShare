# v0.3.13: native creator choices and first-time recipient setup

The creator uses native Codex choices for content scope, access, and duration,
followed by one Publish/Cancel confirmation. Content scope remains conversation,
project files, or both; this release does not add individual-file selection.

The public handoff page now links to setup metadata that works without a relay
query, supplies the exact pinned installation command, and explains how to
bootstrap and answer questions immediately in the same agent session. Receiver
skills also handle a question supplied alongside a link. There is no separate
SDK, persistent MCP configuration, or receiver restart requirement.

Recipient commands retain the attached environment ID, including when multiple
links have been opened. Windows recipients automatically refresh missing or
outdated Codex model metadata in a private home through `model/list`; the
existing version validation and tool restrictions still apply.

Regression checks follow the actual rendered setup link. The packaged local
handoff diagnostic uses the current native form schemas, a separate recipient
install/home, and real Codex MCP read/proposal/refresh/revocation operations.
Its fixture confirmations are synthetic; they are not evidence of a human
navigating the native Codex UI. Deployment smoke also follows the rendered link.

Release status and live evidence must be recorded separately. Do not infer
native UI acceptance or public deployment from passing local tests. Publish the
immutable package before updating the public handoff pin. Stable promotion is
not implied by staging this candidate.

## Local verification — September 20, 2026

- Full coverage run: 370 passed, 8 skipped, no failures.
- Release/deployment tooling: 118 passed, including interrupted-test cleanup.
- Final packaged Windows/Codex 0.155.1 diagnostic: 9 stages passed with a
  separate recipient install, no initial model cache, and two attached links. It
  exercised reads, proposals, owner approval, revision refresh, and revoke.
- Build, lint, formatting, package smoke, edge runtime, and dependency audit
  passed. Independent review found no remaining confirmed blockers after fixes.
- Installed local CLI and managed integrations are v0.3.13; installed and built
  bundle hashes match.

The verified archive is 161393 bytes with SHA-256
`2ddcab849b04544e652062b22b92526a2043964c88a30d4e2ddf062e707e5c8c`. No public
release or deployment has occurred. Human native-UI acceptance, autonomous
first-install from a public link, and real Claude handoff remain unverified.
Native Codex prompts require interactive permissions; YOLO mode auto-declines
them. These limits are not replaced by synthetic test approval.
