# Current-conversation chat sharing

## Objective and dependencies

Implement this approved boundary; dependencies: 04,05. Read index and repository
AGENTS/reasoning first. Preserve unrelated work. No commits/deploys merely from
completing this PR.

## File map

Creator MCP, integration skill/installer/doctor

## Implementation and contracts

Separate creator MCP exposes resolve_creator_session, prepare_share,
review_share, commit_share, share_status. Skill orchestrates only. Server-owned
form elicitation confirms exact sanitized
digest/action/destination/roots/policy. No model boolean/token authorizes.
Unsupported/declined/cancelled host no remote mutation. Terminal fallback same
draft; install preserves config, reload if supported otherwise report restart.
Action-specific proposal/revoke consent.

## Tests and acceptance

Fabricated approval, cross-thread replies, accept/decline/timeout, unsupported
host, stale draft, repeated commit, native confirmation and reload.

Record focused tests, full integration results, limitations, and exact changed
files. No success claim from test presence alone.

## Compatibility, rollout and rollback

Disable chat publication if host confirmation unverified; terminal remains
available.

## Non-goals

Other PRs own their listed boundaries; no credentials/publication/release
changes outside explicit verified workflow.
