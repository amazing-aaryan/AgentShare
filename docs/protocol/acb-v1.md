# Agent Context Bundle v1

ACB v1 is canonical UTF-8 JSON validated by `acbManifestSchema`. It contains a
title, source agent, export timestamp, ordered normalized session events, and an
ordered resource inventory.

## Canonicalization

Objects use lexicographically sorted keys. Arrays retain declared order. Numbers
use JSON representation. Strings use JSON escaping. No insignificant whitespace
is emitted.

Logical fingerprint input excludes `exportedAt`; it consists of all remaining
canonical manifest fields plus ordered resource content hashes. This makes
identical selected content stable across retries while preventing relay-side
correlation because the fingerprint never leaves the creator device.

## Events

Each event has a zero-based sequence, role, kind, text, and source ID. Optional
timestamps preserve provenance but are not required for retrieval.

## Resources

Each resource carries an ID, media type, byte length, SHA-256 hash, and Base64
content. One resource may not exceed 5 MiB. Ciphertext may not exceed 50 MiB.
Source paths are optional and must be reviewed for sensitive metadata.

## Review Boundary

Scanning and review operate on the final normalized plaintext. The creator can
inspect every field and resource after redaction, then confirms the displayed
logical fingerprint. Inventory-only approval is invalid.

Unknown versions fail closed. Compatible readers may add support only after
schema and security review.
