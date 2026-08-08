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
6. Expired or revoked blobs are unavailable and eligible for deletion.

## Capability Link

`https://<host>/s/<share-id>?r=<read-token>#k=<base64url-key>`

The relay receives share ID and read token. The encryption key remains in the
URL fragment and is never included in an HTTP request. Clients must strip the
fragment before logging, analytics, errors, subprocess arguments, or environment
variables.

## Limits

- Maximum requested TTL: 72 hours.
- Maximum ciphertext: 50 MiB.
- Maximum source resource: 5 MiB.

The server response is authoritative. Clients fail closed on metadata mismatch,
expiry, hash mismatch, authentication failure, or unknown protocol version.
