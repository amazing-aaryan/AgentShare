# Public readiness implementation plan

## Scope and baseline

Preserve AgentShare's free, account-free encrypted handoff model. Start from
`db0f6c0e3dade7a52422d4749e32b71b7b34418e`, which contains the reviewed
native-Windows catalog helper but does not call it from the recipient runtime.
Work on `release/public-readiness-20260905`, not the production branch.

## Implementation and verification

1. Add runtime regressions before implementation. Prove native setup occurs
   before spawn, fails closed, preserves the correct provider home, cannot be
   bypassed by caller options, and cannot report success without MCP receipts.
2. Wire the exact-reviewed Windows profile into Codex v2 only. Preserve the
   stronger Linux/macOS read boundary, Claude behavior, MCP tool allowlists,
   creator consent, and private temporary-file cleanup. Disable skills from the
   actual provider home as well as normal user roots.
3. Add bounded, read-only deployment preflight and smoke checks. Require an
   immutable staged package and exact digest, successful candidate CI, protected
   production execution, and explicit selection of changed Workers. Never
   promote a release merely because deployment or static tests passed.
4. Run formatting, lint, build, coverage, conformance, package tests, edge-runtime
   tests, both Wrangler dry-runs, dependency audit, and the complete six-way CI
   matrix. Record exact commit and results; remove temporary diagnostic plumbing.
5. Document the remaining authenticated acceptance and promotion procedure with
   exact artifact, runtime, and observation requirements. Record missing evidence
   as missing, not as an inferred pass. Open a reviewable pull request.

## Release boundary

The existing `codex-only-v1` evidence contract is frozen for v0.3.0 and Codex
0.147.0. Changes to recipient authority require new real-host read/write/network
isolation evidence and successful terminal and native-chat flows using a new
immutable package. Do not mutate historical evidence or existing release bytes.
Do not deploy or promote the candidate until applicable checks pass. No public
capability links, provider credentials, private paths, or user transcripts belong
in repository evidence or CI logs.
