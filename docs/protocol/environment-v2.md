# AgentShare Environment v2

AgentShare v2 changes the shared object from a one-shot handoff to a revisioned
collaborative environment while preserving the v1 `/s/` protocol unchanged.

## Environment link

A recipient capability link has the form:

```text
https://<relay>/e/<environment-id>#r=<read-capability>&k=<environment-master-key>[&p=<proposal-capability>]
```

The URL fragment is client-side secret material. The relay never receives the
fragment in an HTTP request. A read-only link omits `p`.

Creator-only capabilities (`update`, `inbox`, and `revoke`) and the proposal
private key stay in `~/.agentshare/state-v2.json` and are never placed in the
recipient URL.

## Revisions

An environment has one current committed revision. Each revision declares:

- a revision ID and optional parent revision ID;
- one encrypted manifest descriptor;
- zero or more encrypted resource-blob descriptors.

Publication is transactional:

1. Reserve a revision against the current parent.
2. Upload the encrypted manifest and any missing encrypted blobs.
3. Commit the revision.
4. The relay atomically advances `currentRevisionId` only after every declared
   ciphertext object is present with the declared digest and length.

A stale parent produces a conflict. Identical ciphertext uploads are idempotent;
an existing object cannot be replaced with different ciphertext.

Unchanged files reuse stable, environment-keyed blob IDs across revisions, so
only changed resources need new ciphertext uploads.

## Cryptography

The creator generates a random 256-bit environment master key. AgentShare
derives object-specific AES-256-GCM keys with HKDF-SHA256. Authenticated data
binds ciphertext to the environment ID, revision ID, object kind, and object ID.

Resource and manifest encryption/decryption happens on client devices. The relay
stores opaque ciphertext, hashes, lengths, timestamps, lifecycle status, and
capability digests.

## Proposals

Read-plus-propose environments include an X25519 proposal public key in the
encrypted manifest and a proposal capability in the recipient link. The creator
keeps the X25519 private key locally.

A proposal contains deterministic file operations (`create`, `replace`,
`delete`) tied to a specific base revision and base file hashes. The recipient
creates an ephemeral X25519 keypair, derives a proposal encryption key with
HKDF, encrypts the proposal locally, and uploads only ciphertext plus its
descriptor.

The proposal inbox capability is creator-only. Other recipients cannot list or
decrypt submitted proposals.

## Relay routes

```text
POST   /v2/environments
GET    /v2/environments/:id/meta
DELETE /v2/environments/:id

POST   /v2/environments/:id/revisions
PUT    /v2/environments/:id/revisions/:revision/manifest
GET    /v2/environments/:id/revisions/:revision/manifest
POST   /v2/environments/:id/revisions/:revision/commit
PUT    /v2/environments/:id/blobs/:blob
GET    /v2/environments/:id/blobs/:blob

POST   /v2/environments/:id/proposals
GET    /v2/environments/:id/proposals
GET    /v2/environments/:id/proposals/:proposal
POST   /v2/environments/:id/proposals/:proposal/status
```

Capability authorization is endpoint-specific: readers cannot publish or list
proposals; proposers cannot read the owner inbox; inbox holders cannot publish
revisions; only the revoke capability revokes the environment.

## Compatibility

The existing v1 `/s/` routes, one-blob share state machine, `agentshare open`,
and legacy revoke flow remain available. `agentshare share-v1` explicitly
selects the legacy protocol.
