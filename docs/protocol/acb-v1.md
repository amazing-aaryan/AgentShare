# Agent Context Bundle v1

Agent Context Bundle (ACB) is AgentShare's open interoperability boundary. It is
the object that moves between host-specific session adapters and the encrypted
transport. Codex and Claude Code are current adapters to ACB; they are not the
definition of the format.

ACB v1 is canonical UTF-8 JSON validated by `acbManifestSchema`. It contains a
title, source agent, export timestamp, ordered normalized session events, and an
ordered resource inventory.

The project direction is documented in [`../VISION.md`](../VISION.md): future
agents should be able to import/export compatible context without requiring an
AgentShare account, proprietary workspace, or server-side plaintext knowledge
store.

## Design Goals

ACB should remain:

- **portable:** useful across people, machines, and agent vendors;
- **inspectable:** the creator can review the normalized/redacted representation
  before it is encrypted;
- **deterministic:** equivalent selected content has stable canonical form and
  local logical fingerprint semantics;
- **provenance-preserving:** events retain source identifiers and optional
  timestamps rather than collapsing everything into an unverifiable summary;
- **transport-independent:** an ACB can be encrypted and moved through the
  AgentShare blind relay or used by another compatible implementation;
- **versioned and fail-closed:** unknown versions are not guessed at.

ACB v1 is intentionally a current, minimal schema. Broader future context such
as richer tool evidence, decisions, unresolved questions, or additional resource
types must be added through explicit version/schema design rather than
vendor-specific ad hoc fields.

## Canonicalization

Objects use lexicographically sorted keys. Arrays retain declared order. Numbers
use JSON representation. Strings use JSON escaping. No insignificant whitespace
is emitted.

Logical fingerprint input excludes `exportedAt` and the raw resource
`contentBase64` bytes. It includes the remaining canonical manifest fields,
including ordered resource identity and integrity metadata such as SHA-256. This
makes identical selected content stable across retries while preventing
relay-side correlation because the fingerprint never leaves the creator device.

## Events

Each event has a zero-based sequence, role, kind, text, and source ID. Optional
timestamps preserve provenance but are not required for retrieval.

A host adapter should map only the explicitly selected/reviewable context into
these events. Supporting a new agent does not authorize the adapter to crawl
unrelated workspace data.

## Resources

Each resource carries an ID, media type, byte length, SHA-256 hash, and Base64
content. One resource may not exceed 5 MiB. Ciphertext may not exceed 50 MiB.
Source paths are optional and must be reviewed for sensitive metadata.

Resource inclusion is part of the creator's sharing boundary. AgentShare should
prefer explicit, reviewable resource selection over automatic transfer of an
entire project.

## Review Boundary

Scanning and review operate on the final normalized plaintext. The creator can
inspect every text field after redaction and the resource inventory, then
confirms the displayed logical fingerprint. Binary resources are inventoried
rather than rendered byte-for-byte. Inventory-only approval for normalized text
is invalid.

Secret scanning is defense in depth; it does not replace creator review.

## Conformance Vectors

Transport-independent fixtures live under `tests/fixtures/acb-v1/`.
`minimal.json` is a human-readable valid ACB v1 manifest and
`minimal.canonical.txt` is the exact UTF-8 byte sequence a canonical encoder must
emit. The canonical file intentionally has no trailing newline.

The fixture resource contains the six bytes `hello\n` with these fixed values:

```text
byteLength=6
sha256=5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03
contentBase64=aGVsbG8K
logicalFingerprint=e593443d314d81fb178d69940eb59409559ba3828d88185a7d771b036194ac31
```

Run the relay-independent conformance gate with:

```bash
npm run test:conformance
```

The gate validates decoding, resource length and SHA-256, exact canonical
re-encoding, the fixed logical fingerprint, and decode/re-encode stability. It
requires no relay credentials or network access.

Passing these vectors means an implementation agrees on ACB v1 encoding and
integrity behavior. It does not imply compatibility with any particular relay.
A future change that reinterprets existing ACB v1 fields requires an explicit
backward-compatible extension or a new protocol version.

## Interoperability Rule

Compatible implementations may read, write, store, or transport ACBs without
using the official AgentShare relay. The format is not intended to create a
server-side ownership claim over the context.

Unknown versions fail closed. Compatible readers may add support only after
schema and security review.
