# AgentShare v2 Environments Design

## Goal

Turn AgentShare from a one-shot encrypted context handoff into a one-link
collaborative environment. A creator invokes AgentShare with no required
free-form input, shares conversation plus a safe project snapshot, and receives
one capability URL. A recipient pastes that URL into a supported coding agent;
AgentShare is installed/bootstrapped if needed, attaches the environment,
answers questions through an isolated worker, and can submit encrypted
proposals. The creator alone can approve and apply proposals to the real
workspace.

## Product decisions

- Direct-paste is the default recipient UX. The recipient's model provider may
  receive the capability URL because the user pasted it into the conversation.
- Preserve a maximum-privacy path using local/hidden input.
- Codex and Claude Code are the first supported hosts.
- Default creator scope: current conversation + current project.
- Default access: read + propose.
- Default expiry: 24 hours; maximum remains 72 hours initially.
- Git-tracked and nonignored untracked files are eligible. `.gitignore` and
  `.agentshareignore` are respected.
- High-risk credential paths are excluded by default. Symlinks are not
  dereferenced.
- UserB never receives write access to UserA's workspace. Proposals are
  encrypted, deterministic file operations that require creator approval.
- Existing v1 `/s/` links, CLI commands, relay routes, and crypto remain
  supported.

## Architecture

A v2 environment is a long-lived capability object with immutable revisions and
encrypted proposals. The relay stores ciphertext, capability digests, hashes,
timestamps, sizes, and state only. Environment and proposal plaintext are
encrypted/decrypted on clients.

Creator flow:

1. Host adapter captures current conversation plus local workspace root.
2. Workspace snapshotter enumerates safe project files below that root.
3. Scanner applies path policy and content secret scanning.
4. Creator reviews a compact TUI summary and optionally drills into
   files/redactions.
5. Client creates environment capabilities, encrypts manifest/resources, uploads
   a revision, and commits it atomically.
6. Creator receives an `/e/<environment-id>#...` capability URL.

Recipient flow:

1. Recipient agent sees the AgentShare URL and follows the machine-readable
   bootstrap contract.
2. AgentShare installs/repairs integrations if necessary and accepts the
   environment.
3. Ciphertext is cached locally; plaintext is decrypted only while
   indexing/serving restricted reads.
4. Questions are delegated to an isolated Codex/Claude worker with no host
   filesystem, shell, web, network, user skills, plugins, or apps. It receives
   only a local AgentShare MCP surface.
5. Proposed edits are staged against a virtual overlay and uploaded as an
   encrypted proposal.

Creator proposal flow:

1. Creator lists/decrypts pending proposals with an owner-only inbox capability
   and private proposal key.
2. AgentShare validates every path and base hash, renders a normal diff, and
   requires approval.
3. Accepted operations apply transactionally to the real workspace with rollback
   data kept locally and encrypted.
4. AgentShare publishes a new environment revision and marks the proposal
   accepted.

## Protocol objects

### Environment

An environment has:

- `environmentId`
- authoritative creation/expiry metadata
- `currentRevisionId`
- capability digests: read, update, proposal (optional), inbox, revoke
- immutable committed revision descriptors
- encrypted pending/accepted/rejected proposals

### Capabilities

Recipient URL fragment:

- `r`: read capability
- `k`: environment master key
- `p`: proposal capability when proposals are enabled

Creator-only local state:

- update capability
- inbox capability
- revoke capability
- proposal private key

The relay stores only capability digests.

### Environment manifest

`agentshare-environment-v2` contains:

- environment/revision identifiers and parent revision
- title/source/export time
- conversation events
- workspace root display name
- relative file entries containing path, media type, byte length, SHA-256,
  executable flag, and encrypted blob references
- proposal policy and creator proposal public key

Absolute creator paths never enter the manifest.

### Proposals

`agentshare-proposal-v1` contains:

- proposal/environment/base revision identifiers
- created time and summary
- operations: create, replace, delete
- create/replace carry complete new file content, SHA-256, media type
- replace/delete carry the expected base SHA-256

No canonical proposal executes shell commands or uses fuzzy patch application.

## Cryptography

- Environment master key: random 32 bytes.
- Per-object encryption key: HKDF-SHA256(master key, salt=environmentId, info
  namespaced by object kind/id).
- Encryption: AES-256-GCM with random nonce.
- AAD binds protocol, environment ID, revision ID, object kind, and object ID.
- Proposal confidentiality uses X25519: creator embeds a public key in the
  environment manifest; each recipient proposal uses an ephemeral X25519 key,
  HKDF-derived AES key, and AES-256-GCM. Only the creator private key can
  decrypt proposals.

## Workspace safety

- Root is the real path of the current host session working directory.
- Enumeration never traverses above root.
- Git projects use tracked plus nonignored untracked files; `.git/` is never
  shared.
- Non-Git projects recurse with ignore/exclusion rules.
- Always exclude AgentShare state/cache, dependency/build caches, device files,
  sockets, named pipes, and high-risk credential files.
- Symlinks are listed as excluded and never dereferenced in v2.0.
- Every shared path is normalized relative POSIX-style text.
- Proposal validation rejects absolute paths, traversal, `.git`, `.agentshare`,
  symlink/hard-link operations, ACL/ownership changes, and executable-bit
  changes in v2.0.

## Relay v2 API

- `POST /v2/environments`
- `GET /v2/environments/:id/meta`
- `DELETE /v2/environments/:id`
- `POST /v2/environments/:id/revisions`
- `PUT /v2/environments/:id/revisions/:revision/manifest`
- `PUT /v2/environments/:id/blobs/:blobId`
- `GET /v2/environments/:id/revisions/:revision/manifest`
- `GET /v2/environments/:id/blobs/:blobId`
- `POST /v2/environments/:id/revisions/:revision/commit`
- `POST /v2/environments/:id/proposals`
- `GET /v2/environments/:id/proposals`
- `GET /v2/environments/:id/proposals/:proposalId`
- `POST /v2/environments/:id/proposals/:proposalId/status`

Revision publication is transactional: a revision remains `awaiting-blobs` until
every declared ciphertext object exists with the expected hash/size and the
parent equals the current revision. Commit then moves `currentRevisionId`
atomically. Same object ID + same descriptor is idempotent; same ID + different
ciphertext is a conflict.

## Local state

`~/.agentshare/state-v2.json` tracks owned and attached environments plus
interrupted local transactions. State writes remain locked and mode 0600 where
supported. Recipient ciphertext cache lives under
`~/.agentshare/cache/<environment-id>/` with mode 0700/0600. Keys are stored
structurally, not only as raw URLs.

## Recipient worker

The v2 restricted worker is an evolution of the existing isolated launcher. It
runs in an empty temporary directory and fails closed unless the reviewed host
exposes required isolation controls. Its only tool surface is a local AgentShare
MCP server exposing environment info, list/search/read conversation/read file,
proposal staging/diff/submit. It cannot access recipient project files or
arbitrary local files.

## Bootstrap

`GET /e/<environment-id>` serves a human page;
`GET /e/<environment-id>/bootstrap.json` serves a non-secret machine-readable
bootstrap contract with protocol, minimum Node version, pinned AgentShare
release/package digest, and accepted bootstrap action. Normal recipient UX is to
paste the full URL into the agent; manual maximum-privacy instructions remain
available.

## Compatibility

V1 behavior is frozen by regression tests and remains on `/s/` and `/v1/shares`.
V2 uses separate `/e/` and `/v2/environments` routes and new state files so
upgrades do not invalidate existing links.

## Definition of done

A release is not v2-complete until an end-to-end test demonstrates: creator
invokes AgentShare and uses selection keys only; receives one URL; a clean
recipient gives only that URL to Codex/Claude; AgentShare bootstraps/attaches;
recipient answers questions using shared conversation/files with citations;
recipient submits a proposal; creator's workspace remains unchanged until
approval; approval applies transactionally and publishes a new revision; the
original recipient URL sees the updated approved state; relay logs/storage
contain no shared plaintext or decryption keys.
