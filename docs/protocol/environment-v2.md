# AgentShare Environment v2

AgentShare v2 changes the shared object from a one-shot handoff to a revisioned
collaborative environment while preserving the v1 `/s/` protocol unchanged.

## Environment Link

A recipient capability link has the form:

```text
https://<handoff-origin>/e/<environment-id>?relay=https%3A%2F%2F<relay-origin>#r=<read-capability>&k=<environment-master-key>[&p=<proposal-capability>]
```

The handoff and relay origins are intentionally independent. `relay=` is
non-secret transport metadata that tells the local client which compatible
ciphertext relay to contact. The URL fragment is bearer secret material:

- `r` is the read capability;
- `k` is the environment master key;
- optional `p` is the proposal capability.

Browsers do not transmit the fragment in an HTTP request. The trusted handoff
page receives only the path and non-secret relay origin. A read-only link omits
`p`.

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

## Relay Routes

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

## Public-relay Quota Accounting

The production `EnvironmentObject` participates in the same global reservation
controller used by v1 shares. Environment creation reserves one active slot and
records the creator actor digest. As ciphertext is retained, the environment
updates that creator reservation with the total bytes of:

- uploaded revision manifests;
- unique uploaded resource blobs;
- encrypted proposals still retained by the environment.

Proposal traffic remains charged to the creator reservation rather than the
recipient IP that submitted the proposal. This prevents recipients from changing
quota ownership simply by being the party that uploads proposal ciphertext.
Revocation and expiry delete retained ciphertext and release the global
reservation. Capacity checks happen before a new ciphertext object is committed
to Durable Object storage, so a failed quota update cannot create unaccounted
retained bytes.

The outer Worker also applies the existing create/upload rate limiters to v2
routes. V1 `ShareObject` and its quotas remain unchanged.

## Compatibility

The existing v1 `/s/` routes, one-blob share state machine, `agentshare open`,
and legacy revoke flow remain available. `agentshare share-v1` explicitly
selects the legacy protocol.
