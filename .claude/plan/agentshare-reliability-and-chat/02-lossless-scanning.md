# Lossless scanning

## Objective and dependencies

Implement this approved boundary; dependencies: None. Read index and repository
AGENTS/reasoning first. Preserve unrelated work. No commits/deploys merely from
completing this PR.

## File map

packages/scanner, CLI workspace/snapshot and environment/accept

## Implementation and contracts

One strict UTF-8/MIME classifier across scanner/readers. Support
text/JSON/YAML/TOML parameters; reject lossy decode, preserve clean
bytes/BOM/CRLF. Scan quoted JSON keys, v2 links, display metadata; reject
credential-bearing operational paths. Errors identify sanitized relative paths,
never secret fragments. Proposals reject secrets rather than redact.

## Tests and acceptance

MIME and encoding matrix, binary secrets, clean binaries, metadata, idempotence
and exact digests.

Record focused tests, full integration results, limitations, and exact changed
files. No success claim from test presence alone.

## Compatibility, rollout and rollback

No wire changes. Unsupported or unsafe input stays blocked.

## Non-goals

Other PRs own their listed boundaries; no credentials/publication/release
changes outside explicit verified workflow.
