# Immutable drafts and state

## Objective and dependencies

Implement this approved boundary; dependencies: 02. Read index and repository
AGENTS/reasoning first. Preserve unrelated work. No commits/deploys merely from
completing this PR.

## File map

CLI environment preview/publication/state and new draft service

## Implementation and contracts

Capture and scan once before remote allocation. Persist encrypted sanitized
payload outside workspace, owner-only key and permissions. Bind digest to
identity/roots/action/base/destinations/policy/cutoff/scanner/resources.
Approval validity 30min; abandoned retention24h; unresolved transactions
retained. Migrate state atomically to versioned envelope rejecting older
writers. Serialize per environment, persist exact pending ciphertext, reconcile
uncertain remote outcomes.

## Tests and acceptance

Mutation after review, altered digest, stale consent, duplicates/concurrency,
migration, interrupted allocation/upload/commit.

Record focused tests, full integration results, limitations, and exact changed
files. No success claim from test presence alone.

## Compatibility, rollout and rollback

Compatible reader/recovery retained; no old writer downgrade for active
transactions.

## Non-goals

Other PRs own their listed boundaries; no credentials/publication/release
changes outside explicit verified workflow.
