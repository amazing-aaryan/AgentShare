# Blind Relay Protocol v1

The Blind Relay Protocol is the transport half of AgentShare's open context
handoff model. Its job is intentionally narrow: move encrypted Agent Context
Bundles by capability without requiring the relay to receive the conversation
plaintext, encryption key, AgentShare account, or organization membership.

The complete share link is a bearer capability. This makes the protocol portable
across people, machines, communities, and companies, but it also means link
secrecy is access control: anyone who obtains the complete link may be able to
read the share until expiry or revocation.

See [`../VISION.md`](../VISION.md) and
[ADR 0005](../adr/0005-open-context-transport.md) for the project direction.

## State machine

`missing -> awaiting-upload -> available -> revoked|expired`

1. The creator generates a random share ID, upload token, read token, revoke
   token, and local encryption key. The relay receives only SHA-256 capability
   digests.
2. `POST /v1/shares` returns authoritative creation time, expiry, and limits.
   The request body is limited to 8 KiB at the production edge before JSON
   parsing.
3. The creator confirms those values, canonicalizes them as AES-GCM AAD,
   encrypts locally, and performs a write-once upload.
4. Identical upload retries succeed. Different bytes for the same share fail
   with `CONFLICT`.
5. Read and revoke operations authenticate by digest comparison.
6. Expired or revoked blobs are deleted. A permanent status tombstone prevents
   recreation of the same share ID.

## Capability authorization

The base protocol deliberately does not ask a relay to decide whether two users
belong to the same team or company. Possession of the appropriate high-entropy
capability authorizes the corresponding operation.

This keeps the core protocol account-free and cross-organization. It does not
prevent a compatible third-party system from adding an identity layer around its
own distribution of capabilities, but identity is not required for protocol
interoperability.

Clients must treat complete share URLs, read capabilities, upload capabilities,
revoke capabilities, and encryption keys as secrets.

## v0.1.10+ split-origin capability link

Current creator links use an independent trusted handoff origin:

`https://<handoff-origin>/s/<share-id>?relay=<relay-origin>#r=<read-token>&k=<base64url-key>`

The query contains only the non-secret relay origin. The read capability and
encryption key remain in the URL fragment and therefore are not sent to the
handoff server in an HTTP request.

The handoff page reads the fragment locally, removes the query and fragment from
visible browser history, and sends the read capability only in an
`Authorization` header to:

`GET https://<relay-origin>/v1/shares/<share-id>/meta`

The encryption key is never sent to the relay. The handoff page has no
third-party scripts or analytics.

The independent handoff origin is a browser security measure, not an AgentShare
account service. A recipient still needs only the complete capability link and a
supported target agent.

### Browser CORS boundary

The production relay enables cross-origin browser access only for metadata reads
from the exact trusted handoff origin. Allowed preflight is limited to `GET`
plus the `authorization` header on `/v1/shares/<share-id>/meta`.

Create, upload, revoke, and blob-download routes do not expose cross-origin
browser permissions. CORS is a browser boundary, not authentication; every relay
operation still requires the appropriate capability where applicable.

CLI and other non-browser clients are unaffected by CORS.

## Legacy links

Readers retain compatibility with the v0.1.9 same-origin shape:

`https://<relay-origin>/s/<share-id>#r=<read-token>&k=<base64url-key>`

This is compatibility behavior, not the current creator format. New
implementations must use the split handoff/relay model above. Legacy links carry
the older same-origin trust assumptions described in `SECURITY.md`.

## Capability handling

Clients must strip fragments before logging, analytics, errors, subprocess
arguments, or environment variables. Capability URLs must be treated as secrets
because possession grants the corresponding operation.

Forwarding a complete read link forwards access. Current links do not identify
individual readers and current revocation invalidates all readers of that share.
Those semantics are intentional for the simple base transport and must be stated
clearly in compatible clients.

## Blind-relay data boundary

A compliant relay implementation should require only what is necessary to
transport and expire a share: ciphertext, capability digests, authenticated
metadata, size/integrity data, timestamps/status, and admission-control state.
It must not require conversation plaintext or the encryption key.

The official Cloudflare deployment may observe normal transport metadata such as
source network information at the infrastructure boundary and stores a hashed
source identity for quota controls as described below. "Blind" describes the
share-content cryptographic boundary, not network anonymity.

## Limits

- Maximum requested TTL: 72 hours.
- Maximum ciphertext: 50 MiB.
- Maximum source resource: 5 MiB.
- Create JSON body: 8 KiB at the production relay edge.
- Public active shares: 5,000.
- Public active shares per source identity: 25.
- Public active ciphertext: 4 GB.
- Awaiting-upload reservation lifetime: 10 minutes.
- Public create rate: 10 per source IP per minute.
- Public upload rate: 20 per source IP per minute.

These are limits of the free official public relay, not protocol requirements
for every compatible deployment. They exist to keep shared public
infrastructure operable without introducing paid plans or accounts.

The edge derives a SHA-256 source identity from Cloudflare's connection address,
overwrites any client-supplied internal identity header, and stores only the
digest with quota state. This is pseudonymous admission-control data, not
authentication or anonymization.

The server response is authoritative. Clients fail closed on metadata mismatch,
expiry, hash mismatch, authentication failure, or unknown protocol version.

## Self-hosting and compatible relays

Self-hosting is part of the normal open-protocol model, not an enterprise-only
feature. Compatible relays may use different storage implementations or limits
while preserving the cryptographic/capability semantics required by the
protocol version.

A custom relay must not be able to substitute browser JavaScript that reads the
capability fragment for new-format links. That is why the current public client
separates the trusted handoff origin from the selected ciphertext relay.
