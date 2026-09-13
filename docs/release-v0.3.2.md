# v0.3.2 candidate: forward-compatible native Windows acceptance

**Status: candidate, not stable sign-off.** This document defines required
acceptance evidence; it is not evidence that those runs occurred. The v0.3.0
and v0.3.1 releases and their evidence profiles remain frozen and must not be
reinterpreted for these bytes.

## Exact profile

Use `codex-native-windows-v3` for AgentShare **0.3.2**, native Windows build
**26200** (`win32`, `10.0.26200`), Node.js **24.14.0**, and acceptance Codex CLI
**0.153.4**. The historical `codex-only-v1` and `codex-native-windows-v2`
profiles remain frozen for their original packages and runtimes.

AgentShare's runtime compatibility policy is intentionally broader than this
release-evidence profile. Native Windows recipients accept stable Codex CLI
versions at or above 0.152.1 only when the required `exec` and MCP capability
probes continue to pass and the restrictive launcher profile can be applied.
The v3 acceptance profile nevertheless pins one exact real-host runtime so that
evidence remains reproducible and cannot silently change meaning when Codex is
updated later.

The canonical Codex model cache is **metadata, not a security attestation**. A
supported acceptance executable may encounter canonical model metadata written
by a newer stable Codex installation. AgentShare may consume that newer metadata
only after rejecting metadata older than the running executable, filtering out
models whose `minimal_client_version` is newer than the running executable, and
rewriting retained model descriptors into the hardened private catalog. The
canonical Codex home and `models_cache.json` must remain unmodified.

**Native Windows uses a restricted tool surface plus a read-only sandbox. It is
not an OS-enforced read-deny boundary.** Do not infer host confidentiality from
`read-only`, version comparison, successful argument construction, exit code
zero, or a plausible model answer. Fresh actual tool-inventory, hostile
read/write/network attempts, and authenticated MCP continuity evidence remain
required before public promotion.

## Required real-host run

Start from the exact full candidate commit. Record OS/build, Node, the
acceptance binary's own Codex version output, and the canonical model-cache
`client_version` observed on the host. Use the packed CLI installed in a
disposable npm prefix, not a globally installed AgentShare or a source-only
invocation. Do not downgrade, fabricate, replace, or otherwise modify the
creator's normal Codex configuration, authentication, or canonical model cache.

Before the first recipient launch, hash the canonical `models_cache.json` when
present and record its non-secret `client_version`. After both flows and cleanup,
hash that same file again. The before/after hashes must match. Evidence must also
show that AgentShare accepted only model entries compatible with the actual
acceptance executable and produced its separate private hardened catalog. The
private catalog is temporary evidence/runtime state and must be cleaned up.

Use synthetic data with independently generated workspace-only and
conversation-only canaries, a decision with its reason, and unfinished task
state. Run separate **terminal and native Codex chat** creator/recipient flows.
Each must complete create, bootstrap, read, propose, approve, refresh,
isolation, revoke, and cleanup, for **18 successful checks with zero failures,
skips, cancellations, or incomplete checks**.

The v3 profile includes all v2 observations and additionally requires:

- `canonicalModelMetadataUnmodified: true` during isolation evidence.
- `modelMetadataCompatibilityVerified: true`, proving the running executable was
  compatible with the model entries retained in AgentShare's private catalog.

The inherited v2 requirements still include:

- no publication before explicit creator approval;
- an actual successful, independently verified MCP completion receipt;
- recovery of the workspace canary, conversation canary, decision reason and
  unfinished task state without injecting expected values into recipient
  prompts;
- zero outside-workspace reads and writes, zero unexpected network requests,
  zero inherited tools and leaked capabilities;
- actual tool-inventory review and rejection of forged/missing completion
  receipts.

Proposal delivery must reach the owner's inbox without changing the workspace
before explicit owner approval. Refresh must expose the new approved revision
through the same recipient environment and capability. Revocation must return
410 and deny the recipient. Every created share, spawned process and temporary
path must be inventoried and cleaned up, including on failure. Do not retry by
enabling auto-approval, removing isolation controls, injecting canaries into a
recipient prompt, substituting a different acceptance runtime, or editing the
canonical model cache.

Record terminal/native-chat UI approval observations from the human operator. A
mocked elicitation response, protocol fixture or local harness confirmation is
not human approval evidence. A model claiming it used MCP is not an MCP receipt.

## Evidence integrity and promotion

Use the existing `agentshare-release-candidate/v1` and
`agentshare-release-evidence/v1` schemas with profile
`codex-native-windows-v3`. Independently record the immutable package URL,
exact full source commit, byte size, SHA-256, and each Worker's origin, version
UUID, deployment UUID and source commit. Keep redacted evidence attachments and
their actual byte hashes together outside tracked source. Never commit live
capability fragments, auth material, private paths, customer context or raw user
transcripts.

For the canonical model-cache proof, store only redacted metadata and hashes
needed to establish version/integrity. Do not copy authentication or unrelated
Codex state into release evidence.

Verify the actual downloaded package and attached files:

```sh
npm run test:release -- \
  --profile codex-native-windows-v3 \
  --candidate /private/evidence/candidate.json \
  --evidence /private/evidence/report.json \
  --artifact /private/evidence/agentshare-0.3.2.tgz
```

The verifier rejects profile substitutions, wrong runtime/version, missing or
failed checks, malformed resource inventories, wrong hashes, incorrect required
observations and attachment path escapes. It deliberately returns
**`promotable: false`**: structural/byte integrity does not prove who collected
evidence, whether a real native consent UI appeared, or whether the harness was
trustworthy. A human reviewer must inspect those facts.

For public execution, first stage the exact package as an immutable
**prerelease**. Deploy the changed handoff Worker only after that release asset
exists so the public bootstrap never points at nonexistent package bytes. Run
read-only smoke checks and disposable v1/v2 lifecycle checks, re-verify the
immutable prerelease, and then run both authenticated native acceptance flows.
Only after 18/18 acceptance and human evidence review may a reviewer authorize
stable promotion of those same package bytes. A failure leaves the package a
prerelease. Changed bytes require another version; never replace an immutable
asset or rewrite an older profile.

## What automation does not establish

The CI matrix tests source behavior on three operating systems and two Node
versions, package installation, protocol conformance, Worker runtime behavior,
configuration dry-runs, release contracts and dependency audit. It does not sign
in to a human's provider account, observe native chat consent, prove the real
host's tool inventory, or certify production administrative settings. Those
facts remain part of the real Windows acceptance and human release review.
