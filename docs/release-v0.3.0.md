# v0.3.0 release evidence contract

Status: **contract and offline runner only; full-flow evidence pending**. No
deployment, publication, public share, or real recipient run is performed by
these scripts. Nothing in this document claims v0.3.0 passed its release gate.

## Scope and invocation

The only new profile is `codex-only-v1`: AgentShare `0.3.0`, Windows build
26200, Node.js `24.14.0`, Codex CLI `0.147.0`. No Claude or cross-platform claim
follows. Changing the required inventory, assertions, or runtime requires a new
profile version; do not silently relax this one.

```powershell
node scripts/test-release.mjs --profile codex-only-v1 --candidate evidence/candidate.json --evidence evidence/report.json --artifact evidence/agentshare-0.3.0.tgz
# Equivalent standalone offline verifier:
node scripts/release-evidence.mjs --profile codex-only-v1 --candidate evidence/candidate.json --evidence evidence/report.json --artifact evidence/agentshare-0.3.0.tgz
# Focused synthetic tests; no live services or authenticated CLIs:
node --test scripts/release-evidence.test.mjs
```

All four flags are mandatory for explicit profile runs. Unknown flags/profiles,
duplicate flags, missing files, schema errors, and evidence failures exit 1.
Success exits 0 and prints `Evidence contract verified`, not a deployment or
publication claim. The verifier reads local files only; it does not run the
collection harness, fetch the archive, or query Worker deployments.

The return value explicitly sets `promotable: false`: this is a contract and
file-integrity check, not an attestation of native human consent. Attachments
are hashed, not semantically interpreted as trusted host receipts. A trusted
full-flow collector and review of native host evidence remain required before
promotion; a self-authored report cannot supply that proof.

No-argument `npm run test:release` retains the existing both-agent suites and
origin requirements. It now warns that this legacy gate is not promotable as
full v2 published-artifact evidence. `test:live:diagnostic` also remains partial
and nonpromotable. Do not convert their test counts into a full-flow report.

## Independent candidate manifest

Freeze this manifest independently **before** collection. Do not derive expected
hashes, commit, run ID, or Worker identities from the report being checked. Pass
the same downloaded published archive used for the isolated installations. The
verifier checks its actual byte count and SHA-256 against this manifest.

Every listed field is required; unknown fields are rejected at every defined
object boundary. JSON uses numbers for sizes/counts/exit codes and booleans for
assertions. Hex values are lowercase; Git commits are full 40-character hashes.

| Candidate field | Exact contract                                |
| --------------- | --------------------------------------------- |
| `schemaVersion` | `agentshare-release-candidate/v1`             |
| `profile`       | `codex-only-v1`                               |
| `runId`         | Unique collection ID, also required in report |
| `artifact`      | Object below                                  |
| `workers`       | `{relay, handoff}`, each with identity below  |

`artifact` has exactly `name` (`agentshare`), `version` (`0.3.0`), `url`
(published archive HTTPS URL without credentials/query/fragment), `sha256` (64
hex characters), `sizeBytes` (positive safe integer), and `commit` (full source
commit). This binds the tested archive, not a rebuild from the checkout.

Each Worker identity has exactly `name`, `origin` (bare HTTPS origin without a
trailing slash), `versionId`, `deploymentId` (both full lowercase UUIDs), and
`sourceCommit` (40 hex characters). Relay and handoff origins must differ.
Collect these from the actual deployed versions; shortened IDs are invalid.
Worker source commits may differ from the CLI commit but must exactly match the
independently frozen manifest. Keep identity observations in attachments.

## Strict report object

The root has exactly these fields:

| Field                          | Contract                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `schemaVersion`                | `agentshare-release-evidence/v1`                                                         |
| `profile`                      | `codex-only-v1`                                                                          |
| `evidenceKind`                 | `published-artifact-full-v2`; legacy/fixture/source kinds rejected                       |
| `runId`, `artifact`, `workers` | Deep equality with independent candidate                                                 |
| `runtime`                      | Exact object below, observed in collecting runtime                                       |
| `harness`                      | Exactly `{id, version, commit}`: collector identity/version/full commit                  |
| `startedAt`, `completedAt`     | Nonempty whole-run time window                                                           |
| `execution`                    | Exactly `{exitCode: 0, signal: null, completed: true}`                                   |
| `summary`                      | Exactly `{required: 18, passed: 18, failed: 0, skipped: 0, cancelled: 0, incomplete: 0}` |
| `flows`                        | Exactly two distinct flow objects, one terminal and one chat                             |
| `checks`                       | Exactly one record for every frozen check ID below                                       |
| `attachments`                  | Nonempty hashed evidence inventory, all referenced by checks                             |
| `cleanup`                      | Complete per-resource outcomes below                                                     |

```json
{
  "platform": "win32",
  "osRelease": "10.0.26200",
  "nodeVersion": "24.14.0",
  "agent": "codex",
  "agentVersion": "0.147.0"
}
```

The verifier may run on another machine; `runtime` describes the actual
collection host, not the offline verifier. Record binary version output and
OS/build observations in the hashed attachments. Timestamps throughout are UTC
ISO strings with milliseconds (`2026-08-27T12:00:00.000Z`). Stage windows must
be nonempty, ordered as listed within each flow, and inside the run window. The
two flows may overlap. Top-level cleanup completion follows both final stages.

IDs use `[A-Za-z0-9][A-Za-z0-9._:-]{0,159}`. Store identifiers only, never
capability URLs, keys, auth tokens, private paths, or unredacted session data.

### Flow identity

Each flow has exactly `id`, `surface` (`terminal` or `chat`), `environmentId`,
`proposalId`, `revisionBefore`, `revisionAfter`, `creatorSessionId`,
`recipientSessionId`, `shareIds`, `processIds`, `tempPathIds`.

Scalar IDs are nonempty. Flow/environment/proposal and same-role session IDs
must differ between flows; creator and recipient sessions must differ within
each flow; before/after revision IDs must differ. The final three fields are
nonempty arrays of unique identifiers, also unique across flows. Use opaque
resource IDs for processes and temporary paths, recording the redacted mapping
in attachments. Enumerate **every** created resource, including extra shares,
failed-attempt resources, child processes, and isolated installation
directories. Retained evidence files are not ephemeral resources to delete.

### Frozen checks and observations

Each table row is required twice: `terminal.<stage>` and `chat.<stage>`. This is
an exact 18-ID inventory, not an arbitrary test count.

| Stage       | Exact `observations` object                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `create`    | `{explicitCreatorApproval: true, encryptedUpload: true, capabilityRedacted: true}`                         |
| `bootstrap` | `{isolatedPublishedInstall: true, installedVersion: "0.3.0", mcpRegistered: true}`                         |
| `read`      | `{mcpToolSucceeded: true, groundedCitation: true, cancelledCalls: 0}`                                      |
| `propose`   | `{mcpToolSucceeded: true, inboxReceived: true, workspaceUnchangedBeforeApproval: true, cancelledCalls: 0}` |
| `approve`   | `{explicitOwnerApproval: true, appliedExpectedDiff: true}`                                                 |
| `refresh`   | `{newRevisionVisible: true, groundedCitation: true}`                                                       |
| `isolation` | `{outsideWorkspaceWrites: 0, unexpectedNetworkRequests: 0, inheritedTools: 0, capabilityLeaks: 0}`         |
| `revoke`    | `{httpStatus: 410, recipientDenied: true}`                                                                 |
| `cleanup`   | `{activeShares: 0, remainingProcesses: 0, remainingTempPaths: 0}`                                          |

Every check has exactly `id`, `flowId`, `status` (`passed`), `startedAt`,
`completedAt`, `exitCode` (`0`), `signal` (`null`), `observations` (exact table
object), and `attachmentIds` (nonempty unique array referencing attachments).
`flowId` must identify the matching surface. Serialized array order is not
significant, but recorded stage timestamps must follow the frozen order.

Terminal creation means the published CLI's interactive creator path. Chat
creation means the creator integration invoked from a real Codex chat session.
Continue each independently through the same v2 lifecycle. Read/propose evidence
must include actual successful MCP tool calls and outputs, grounded citations,
and matching environment/proposal/revision IDs. Preloaded answers, tool intent,
cancelled calls, and launch success are insufficient. Approval must be an
observed owner decision, not a harness bypass. Refresh must demonstrate
retrieval of the newly approved revision. Revocation requires both recipient
denial and HTTP 410; expiry, 404, and unavailable networking do not substitute.

Isolation requires active probes of outside-workspace writes, unauthorized
network requests, inherited non-allowlisted tool surfaces, and capability leaks
in arguments/environment/logs/persisted state. Required harness-owned MCP tools
and their explicitly permitted relay traffic are not unexpected traffic/tools.
Keep the probe method, blocked attempts, and observed absence of effects in
attachments. Empty logs or a startup refusal do not prove a functioning flow.
Run these probes before revocation while the recipient workflow still operates.

### Attachments and cleanup

An attachment has exactly `{id, path, sha256, sizeBytes}`. Path is relative to
the report directory and uses `/`; allowed characters are letters, digits, `_`,
`-`, `.`, and `/`, with an initial letter/digit/underscore/hyphen. Empty
segments, `.`/`..` segments, absolute paths, duplicate paths (case insensitive),
and symlink/junction escapes are rejected. Each attachment must be a regular
file with matching positive byte length and SHA-256. Check references must
resolve; unreferenced attachments are rejected. Several checks may cite one
transcript if it contains the evidence for each. JSON inputs are limited to 2
MiB each.

`cleanup` has exactly `status` (`complete`), `completedAt`, and these arrays:

- `shares`: exactly all flow `shareIds`, each `{id, httpStatus: 410}`.
- `processes`: exactly all flow `processIds`, each `{id, exited: true}`.
- `tempPaths`: exactly all flow `tempPathIds`, each `{id, removed: true}`.

No duplicate, missing, or extra resource IDs. Cleanup assertions alone cannot
replace the resource inventory. Collect cleanup in a `finally` path even on
failure, but retain failed/cancelled status: a clean teardown does not turn a
failed run into success. Never merge passes from different runs or hide retries;
a fresh acceptance run gets a new frozen run ID.

## Harness integration and trust limits

The public module exports `PROFILE`, `RUNTIME`, `SCHEMA_VERSION`,
`CANDIDATE_VERSION`, `REQUIRED_CHECK_IDS`, `REQUIRED_OBSERVATIONS`,
`validateCandidate`, `validateReleaseEvidence`, `verifyReleaseEvidenceFiles`,
and `runEvidenceCli`. Validators throw on failure; successful report validation
returns `{profile, runId, checks: 18}`. `validateReleaseEvidence` checks
structure only. The CLI always additionally verifies archive and attachment
bytes through `verifyReleaseEvidenceFiles({evidence, candidate, artifact})`.

Parent harness must collect real observations, use isolated installs of the
exact archive, retain redacted tool/PTY transcripts, bind all IDs to one run,
collect deployed Worker identity, and generate the report after teardown. Do not
fill assertions from `REQUIRED_OBSERVATIONS` as if they were measured results;
those exports describe expectations. Synthetic tests deliberately exercise
accepted shapes but are not real evidence and must never be published as such.
The test fixture archive is not even an npm package.

This is a consistency/integrity gate, not a signature or authenticity system. A
fabricated report plus matching fabricated attachments cannot be detected solely
by schema/hash validation. A trusted collector, independent frozen candidate,
review of transcripts, and verified archive origin remain required. The offline
verifier cannot prove the archive was published, that observations are truthful,
or that deployed Workers have not changed since collection. Release
authorization and actual publication/deployment remain separate gates.
