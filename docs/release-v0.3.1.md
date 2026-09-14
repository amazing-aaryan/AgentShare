# v0.3.1 candidate: native Windows acceptance

**Status: candidate, not stable sign-off.** This document defines required
acceptance evidence; it is not evidence that those runs occurred. The v0.3.0
release is immutable and must not be replaced with the new CLI bytes.

## Exact profile

Use `codex-native-windows-v2` for AgentShare **0.3.1**, native Windows build
**26200** (`win32`, `10.0.26200`), Node.js **24.14.0**, and Codex CLI
**0.152.1**. The historical `codex-only-v1` profile remains frozen for 0.3.0 /
Codex 0.147.0. Neither contract grants support to another runtime simply because
its version is newer. A future runtime or changed inventory requires another
profile version.

The new runtime integrates the private hardened model catalog before recipient
spawn and preserves the same canonical Codex home for metadata and
authentication. Unsupported versions, missing/stale model metadata, and setup
failures stop the recipient rather than silently falling back to unrestricted
execution. Linux and macOS retain the split-read deny profile; Claude behavior
is unchanged.

**Native Windows uses a restricted tool surface plus a read-only sandbox. It is
not an OS-enforced read-deny boundary.** Do not infer host confidentiality from
`read-only`, successful argument construction, exit code zero, or a plausible
model answer. Fresh actual tool-inventory, hostile read/write/network attempts,
and authenticated MCP continuity evidence are required before public promotion.

## Required real-host run

Start from the exact full candidate commit. Record OS/build, Node and the
binary's own Codex version output. Use the packed CLI installed in a disposable
npm prefix, not a globally installed older AgentShare or a source-only
invocation. Do not alter the creator's normal Codex configuration,
authentication, or provider cache.

Use synthetic data with independently generated workspace-only and
conversation-only canaries, a decision with its reason, and unfinished task
state. Run separate **terminal and native Codex chat** creator/recipient flows.
Each must complete create, bootstrap, read, propose, approve, refresh,
isolation, revoke, and cleanup, for **18 successful checks with zero skips or
cancellations**.

The v2 profile adds these required observations to the historical full-flow
inventory in `scripts/release-evidence.mjs`:

- No publication before explicit creator approval.
- An actual successful, independently verified MCP completion receipt and
  recovery of the workspace canary, conversation canary, decision reason, and
  task state.
- Zero outside-workspace reads and writes, zero unexpected network requests,
  zero inherited tools and leaked capabilities; actual tool-inventory review and
  rejected attempts to forge a completion receipt.

Proposal delivery must reach the owner's inbox without changing the workspace
before explicit owner approval. Refresh must expose the new approved revision.
Revocation must return 410 and deny the recipient. Every created share, spawned
process and temporary path must be inventoried and cleaned up, including
failures. Do not retry by enabling auto-approval, removing isolation controls,
injecting the canaries into a recipient prompt, or substituting a different
model/runtime.

Record terminal/native-chat UI approval observations from the human operator. A
mocked elicitation response, protocol fixture or local harness confirmation is
not human approval evidence. A model claiming it used MCP is not an MCP receipt.

## Evidence integrity and promotion

Use the existing `agentshare-release-candidate/v1` and
`agentshare-release-evidence/v1` schemas with the new profile name.
Independently record the immutable package URL, exact full source commit, byte
size, SHA-256, and each Worker's origin, version UUID, deployment UUID and
source commit. Keep redacted evidence attachments and their actual byte hashes
together outside tracked source. Never commit live capability fragments, auth
material, private paths, customer context or raw user transcripts.

Verify the actual downloaded package and attached files:

```sh
npm run test:release -- \
  --profile codex-native-windows-v2 \
  --candidate /private/evidence/candidate.json \
  --evidence /private/evidence/report.json \
  --artifact /private/evidence/agentshare-0.3.1.tgz
```

The verifier rejects profile substitutions, wrong runtime/version, missing or
failed checks, malformed resource inventories, wrong hashes and attachment path
escapes. It deliberately returns **`promotable: false`**: structural/byte
integrity does not prove who collected evidence, whether a real native consent
UI appeared, or whether the harness was trustworthy. A human reviewer must
inspect those facts.

For public execution, first stage the exact package as an immutable
**prerelease**, then deploy only changed Workers through the protected workflow
described in the [deployment runbook](operations/cloudflare-deployment.md). Run
read-only smoke checks and disposable v1/v2 lifecycle checks, followed by both
authenticated native flows. Only then may a reviewer authorize stable promotion
of those same bytes. A failure leaves the package a prerelease. Changed bytes
require another version; never replace an already published immutable asset or
reinterpret old evidence.

## What automation does not establish

The CI matrix tests source behavior on three operating systems and two Node
versions, package installation, protocol conformance, Worker runtime behavior,
configuration dry-runs, release contracts and dependency audit. It does not sign
in to a human's provider account, observe their native chat consent, or certify
a production environment's administrative settings. Claude authentication and
unchanged adapter behavior are not newly certified by this Codex-only profile.
