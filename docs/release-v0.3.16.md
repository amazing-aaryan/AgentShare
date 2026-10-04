# v0.3.16: current deployment dependencies and native acceptance contract

**Status: stable/latest immutable release, promoted 2026-10-02.** The owner's
explicit delegation authorized technical acceptance and release review. The
[release verification record](releases/v0.3.16-release-verification.md)
separates that decision from the frozen personal-human contract below; a clean
human 18/18 certificate is not claimed. Historical profiles, the offline
verifier's `promotable: false`, and immutable v0.3.15/v0.3.16 archives remain
unchanged. This release retains v0.3.15's optional Codex prompt-default setup
and managed skill placement.

A fresh install on 2026-10-02 found newly reported high-severity advisories in
the development dependency graph: ESLint's brace-expansion and Wrangler's undici
dependency. The previous production workflow would fail its mandatory
`npm audit --audit-level=high` step with the old lockfile. This release updates
the affected dependency chains within their declared ranges. The packaged CLI
has no installed production dependency graph; the clean production-only audit
does not replace the required full build/deployment audit.

This release also repairs native Windows recipient model selection when the
desktop app and CLI share `CODEX_HOME` but use different Codex versions. A newer
desktop cache can contain a model alias unavailable to the installed CLI even
when no minimum client version is advertised. AgentShare now requires cache
metadata from the exact executable version and refreshes mismatches using that
CLI in its private authenticated home. It preserves the creator's canonical
cache and hardens the refreshed catalog with the same tool restrictions. This
applies to both query and environment recipients and does not override a model
or import the creator's configuration.

## Frozen personal-human acceptance contract

The following requirements remain the original v6 contract. They are not a
description of the separate delegated stable decision, and have not been relaxed
to certify agent-operated choices as personally operated human steps.

### Exact native Windows profile

Use `codex-native-windows-v6` only for AgentShare **0.3.16**, Windows release
**10.0.26200** (build 26200), Node.js **24.14.0**, and Codex CLI **0.155.1**.
The v6 profile retains every observation from `codex-native-windows-v5`; only
the installed AgentShare version and exact reviewed Codex runtime change.
Defining the profile is not evidence that the real-host run occurred.

Use the anonymously downloaded immutable published archive in a disposable npm
prefix. Record its actual byte size, SHA-256 and tag commit before testing.
Confirm all six candidate CI matrix jobs pass on that exact commit. After
genuine production review, verify that both public handoff surfaces and the
queryless bootstrap metadata pin the same archive. Retain relay/handoff
deployment provenance privately with the evidence.

Complete separate terminal and native Codex chat journeys under the
[full native Windows contract](release-v0.3.2.md): **18/18 checks**, with no
failed, skipped, cancelled or incomplete stages. Use the v6 runtime and package
identities above instead of the historical v3 identities.

Each journey requires observed human creator approval, authenticated MCP reads
recovering independent workspace/conversation canaries and decision/task state,
proposal delivery with no premature workspace mutation, separate human owner
approval, same-link revision refresh, hostile isolation checks, 410 revocation,
and full share/process/temp-path cleanup. Never inject expected canaries into
recipient prompts or accept model text as an MCP receipt.

Hash the creator's canonical model metadata before and after the journeys.
Record only its non-secret client version and digest. The original file must
remain unchanged; the recipient's private hardened catalog must be compatible
with the exact executable and removed during cleanup. The Windows restricted
tool surface does not provide an OS-enforced read-deny boundary.

### First-use setup and skill acceptance

Before final human review, also retain real host evidence for:

- native Install/Cancel and optional future-session permission choices;
- Cancel and incomplete forms leaving CLI/skills/config unchanged;
- keeping the permission default without changing it;
- saving On Request only after that exact human choice, with a private backup
  and preservation of unrelated settings;
- unchanged permissions in the already active host session;
- matching standard/Codex-home managed skills and fresh-session discovery,
  including a crowded skill catalog;
- a fresh recipient following the public link, installing the exact pin,
  attaching the environment and performing an actual grounded MCP read.

Use disposable setup homes and synthetic context. Do not change the user's
canonical authentication, configuration or model metadata to fabricate results.
Keep these additional setup observations as hashed redacted attachments for
human review; they are separate from the verifier's frozen 18-stage inventory.
Synthetic protocol responses and a local packaged diagnostic do not establish
native UI acceptance or autonomous public-link onboarding.

### Offline verification and human release decision

Run against the actual retained files:

```powershell
npm run test:release -- --profile codex-native-windows-v6 --candidate C:\private\evidence\candidate.json --evidence C:\private\evidence\report.json --artifact C:\private\evidence\agentshare-0.3.16.tgz
```

The verifier must accept the actual archive and attachment hashes and still
return `promotable: false`. It validates contract/file integrity, not human
identity, real UI behavior, or collection provenance. Human evidence review and
explicit stable-release authorization remain required.

Claude execution is outside this Codex-only stable profile. A real Claude
diagnostic is useful separate compatibility evidence and must not be reported as
satisfying the native Codex gate. Any changed published package bytes require
another immutable candidate version.

## Recorded local candidate validation before publication

On 2026-10-02, the candidate passed build/lint/formatting, 383 Vitest tests with
eight opt-in skips and coverage thresholds, 126 release-tool tests, ACB
conformance, isolated package installation, edge runtime, both Worker deployment
dry runs, and a full dependency audit with zero advisories. Independent
adversarial source review reported no actionable findings.

The rebuilt exact locally packaged CLI passed all nine Codex handoff diagnostic
stages with desktop model metadata newer than the installed CLI. Private refresh
worked and the test's canonical metadata copy retained the same before/after
hash. Two separate real Codex checks passed hostile write/network isolation and
grounded two-turn continuity. The earlier pre-fix package also passed a
nine-stage diagnostic with no initial model cache. These runs used synthetic
fixture consent and a loopback relay and are explicitly nonpromotable;
terminal/native human consent and public published-artifact acceptance were
unverified at that stage. Later delegated public/native evidence and the stable
decision are recorded separately in the linked release verification record.

A separate real Claude diagnostic reached the provider but failed because its
OAuth session had expired and could not be refreshed. A reported signed-in
status and successful version/capability preflight did not establish usable
authentication. Renewed login would be needed for that diagnostic to pass; the
owner excluded further Claude execution from the v0.3.16 release decision.
