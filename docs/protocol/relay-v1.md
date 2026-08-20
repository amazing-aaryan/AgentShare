# Blind Relay Protocol v1

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

## v0.1.10 split-origin capability link

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

The edge derives a SHA-256 source identity from Cloudflare's connection address,
overwrites any client-supplied internal identity header, and stores only the
digest with quota state. This is pseudonymous admission-control data, not
authentication or anonymization.

The server response is authoritative. Clients fail closed on metadata mismatch,
expiry, hash mismatch, authentication failure, or unknown protocol version.
