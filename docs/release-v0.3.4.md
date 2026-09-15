# v0.3.4 candidate: managed-context capture repair

**Status: candidate, not stable sign-off.** This document defines the required
acceptance evidence for repaired bytes. It does not claim that acceptance ran.
The immutable v0.3.2 and v0.3.3 artifacts and their evidence profiles remain
frozen.

## Exact profile

Use `codex-native-windows-v5` for AgentShare **0.3.4**, native Windows build
**26200** (`win32`, `10.0.26200`), Node.js **24.14.0**, and Codex CLI
**0.153.4**. The v5 profile inherits every observation from
`codex-native-windows-v4`; only the installed AgentShare version changes.

This repair excludes Codex-managed bootstrap records whose message role is
`user` but whose `content_item_kinds` identify plugin recommendations,
`AGENTS.md` instructions, environment context, or other non-user material.
Legacy records without this metadata remain supported. Metadata-bearing user
messages are retained only when every content kind is explicitly `user.*` and
the kind count matches the content count.

## Required real-host run

Follow the complete native Windows contract in
[`release-v0.3.2.md`](./release-v0.3.2.md): exact published package, exact
candidate commit, separate terminal and native-chat flows, explicit human
creator and proposal approvals, authenticated MCP completion receipts,
independent workspace/conversation canaries, decision reason and unfinished task
recovery, hostile isolation checks, refresh, 410 revocation, and complete
resource cleanup. Require all **18/18** checks with zero failures, skips,
cancellations, or incomplete checks.

Additionally inspect each retained draft and recipient read. Neither may contain
managed plugin recommendations, host instructions, environment bootstrap
context, raw unrelated transcripts, or expected canary values injected by the
recipient prompt. A leak invalidates the run.

Before the first recipient launch, hash the canonical `models_cache.json` and
record its non-secret `client_version`. Hash it again after both flows and
cleanup. Hashes must match. AgentShare's private hardened model catalog must
contain only entries compatible with the exact acceptance executable, then be
removed during cleanup.

## Evidence and promotion

Keep candidate/report JSON and redacted attachment bytes outside tracked source.
Verify the exact downloaded archive and attachments offline:

```powershell
npm run test:release -- --profile codex-native-windows-v5 `
  --candidate C:\private\evidence\candidate.json `
  --evidence C:\private\evidence\report.json `
  --artifact C:\private\evidence\agentshare-0.3.4.tgz
```

The verifier deliberately returns `promotable: false`; it proves contract and
file integrity, not human identity or UI consent. A human reviewer must inspect
native approval observations, real tool inventory, hostile attempts, MCP
receipts, canary recovery, worker provenance, and cleanup.

Stage only an immutable prerelease. Deploy only after protected preflight
verifies the same commit and package bytes. Stable promotion is permitted only
after 18/18 real-host acceptance, offline verification, and human evidence
review. Any changed bytes require another version.
