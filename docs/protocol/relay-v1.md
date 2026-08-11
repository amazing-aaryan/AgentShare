# Blind Relay Protocol v1

## State Machine

`missing -> awaiting-upload -> available -> revoked|expired`

1. Creator generates random share ID, upload token, read token, and revoke
   token. Relay receives only SHA-256 token digests.
2. `POST /v1/shares` returns authoritative creation time, expiry, and limits.
3. Creator separately confirms those values, canonicalizes them as AES-GCM AAD,
   encrypts locally, then performs a write-once upload.
4. Identical upload retries succeed. Different bytes for the same share fail
   with `CONFLICT`.
5. Read and revoke operations authenticate by digest comparison.
6. Expired or revoked blobs are deleted. A permanent status tombstone prevents
   the share ID and capability URL from being recreated.

## Capability Link

`https://<host>/s/<share-id>#r=<read-token>&k=<base64url-key>`

The browser receives the read token and encryption key from the URL fragment,
removes the fragment from visible history, then sends the read token only in an
Authorization header. Neither capability appears in relay request URLs. Clients
must strip the fragment before logging, analytics, errors, subprocess arguments,
or environment variables. Readers remain backward compatible with v0.1.1 links.

## Limits

- Maximum requested TTL: 72 hours.
- Maximum ciphertext: 50 MiB.
- Maximum source resource: 5 MiB.
- Public active shares: 5,000.
- Public active ciphertext: 4 GB.
- Public create rate: 10 per source IP per minute.
- Public upload rate: 20 per source IP per minute.

The server response is authoritative. Clients fail closed on metadata mismatch,
expiry, hash mismatch, authentication failure, or unknown protocol version.
