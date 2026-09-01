# Scoped proposal application

## Objective and dependencies

Implement this approved boundary; dependencies: 01,03. Read index and repository
AGENTS/reasoning first. Preserve unrelated work. No commits/deploys merely from
completing this PR.

## File map

CLI proposals, inbox, committed-base state

## Implementation and contracts

Hydrate authenticated base; pin proposal/draft/base/current revision. Membership
and exclusions before preview; raw owner hash conflicts retained. Next revision
is approved base plus proposal operations, never unrelated recapture. Explicit
approval bound operations and outbound revision. Serialize/revalidate, journal
exact phases, retry same publication. Rollback only transaction-written current
bytes.

## Tests and acceptance

Unrelated files/conversation unchanged; redacted conflict; excluded create;
stale revision; concurrent approval; symlink; crash phases.

Record focused tests, full integration results, limitations, and exact changed
files. No success claim from test presence alone.

## Compatibility, rollout and rollback

Disable new approval but retain recovery. No blind reapply/rollback.

## Non-goals

Other PRs own their listed boundaries; no credentials/publication/release
changes outside explicit verified workflow.
