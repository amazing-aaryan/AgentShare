# ACB v1 Conformance Vectors

AgentShare publishes transport-independent test vectors for the Agent Context
Bundle (ACB) format. A compatible implementation must be able to consume these
fixtures without calling the AgentShare relay, handoff Worker, or any hosted
AgentShare service.

## Fixtures

The canonical fixture lives under `tests/fixtures/acb-v1/`:

- `minimal.json` is a human-readable valid `acb-v1` manifest.
- `minimal.canonical.txt` is the exact UTF-8 byte sequence an ACB v1 canonical
  encoder must emit. It intentionally has no trailing newline.

The fixture contains one conversation event and one text resource containing the
six bytes `hello\n`.

```text
byteLength=6
sha256=5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03
contentBase64=aGVsbG8K
logicalFingerprint=e593443d314d81fb178d69940eb59409559ba3828d88185a7d771b036194ac31
```

## Required Checks

A conforming ACB v1 implementation should:

- parse `minimal.json` as `acb-v1` and reject an unknown `version` rather than
  guessing how to interpret it;
- decode every resource's canonical Base64 payload;
- verify each resource's declared byte length and SHA-256 before accepting the
  bundle;
- canonically encode the validated manifest with recursively sorted object keys,
  array order preserved, no insignificant whitespace, and UTF-8 output;
- compare the emitted bytes exactly with `minimal.canonical.txt`;
- decode those canonical bytes again and recover the same validated manifest;
- compute the logical fingerprint and compare it with the expected value above.
  `exportedAt` and resource `contentBase64` are intentionally excluded from that
  fingerprint; resource identity and integrity metadata remain included.

The repository gate is:

```bash
npm run test:conformance
```

This command does not need relay credentials or network access.

## Compatibility Rule

Passing these vectors means an implementation agrees with AgentShare on this
ACB v1 encoding and integrity behavior. It does not imply compatibility with a
particular relay implementation. ACB and transport are deliberately separate
layers.

Future changes that alter the meaning or canonical representation of existing
ACB v1 fields must not silently reinterpret these fixtures. Add a new protocol
version or a separately specified backward-compatible extension instead.
