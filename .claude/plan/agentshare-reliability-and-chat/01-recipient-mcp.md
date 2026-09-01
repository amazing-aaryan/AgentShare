# Recipient MCP and completion

## Objective and dependencies

Implement this approved boundary; dependencies: None. Read index and repository
AGENTS/reasoning first. Preserve unrelated work. No commits/deploys merely from
completing this PR.

## File map

worker/environment-launcher.ts, worker/internal-mcp.ts, launchers.ts,
commands/ask-v2.ts, commands/propose-v2.ts

## Implementation and contracts

Pin Codex 0.147.0. Reproduce cancellation with harmless MCP fixture; annotate
tools truthfully, require server startup and exact per-command allowlists;
preserve all isolation controls. Add trusted metadata-only completion receipts;
read requires completed evidence access, proposal requires matching submission
receipt, not model prose or exit zero. Pin staged revision.

## Tests and acceptance

Missing server, cancelled call, error result, false prose, missing proposal
receipt, unknown runtime, unlisted tools.

Record focused tests, full integration results, limitations, and exact changed
files. No success claim from test presence alone.

## Compatibility, rollout and rollback

Disable unsupported execution; never restore false success.

## Non-goals

Other PRs own their listed boundaries; no credentials/publication/release
changes outside explicit verified workflow.
