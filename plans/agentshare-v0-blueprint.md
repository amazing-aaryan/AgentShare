# AgentShare v0 Construction Blueprint

Status: Final; strongest-model adversarial gate passed  
Created: 2026-08-08  
Objective: Build a fully open-source system that lets a Codex or Claude user
select working context, publish it as a client-encrypted link lasting at most 72
hours, and let a coworker query it from a temporary read-only Codex or Claude
session without installing AgentShare in advance.

## 1. Product Contract

AgentShare v0 transfers observable working context, not a model's hidden state.
A creator selects Codex or Claude sessions and repository files, reviews the
exact payload, encrypts it locally, and uploads ciphertext to a blind relay. A
coworker runs one `npx` command from the landing page. The connector downloads
and decrypts locally, exposes the bundle through a temporary read-only MCP
server, launches Codex or Claude, and removes temporary state when the process
exits.

### v0 in scope

- Codex-to-Claude, Codex-to-Codex, Claude-to-Codex, and Claude-to-Claude
  querying.
- Creator shell command plus creator-side `/share` integration.
- One-time global creator setup.
- Interactive session and file selection.
- Secret scan plus exact payload preview before upload.
- Provider-neutral Agent Context Bundle (ACB) v1.
- Client-side authenticated encryption.
- Unlisted capability link with a hard 72-hour maximum lifetime.
- Blind ciphertext relay with expiry and revocation.
- Zero-prior-install recipient bootstrap using a version-pinned `npx` command
  followed by a hidden TTY prompt for the capability URL.
- Temporary authenticated loopback MCP and temporary agent configuration.
- Read-only querying only. No context writes, shell execution, or source-session
  mutation through AgentShare.
- Local idempotency: identical live bundle reuses its link; `--new` forces a new
  link.

### Explicitly out of scope

- Hidden chain-of-thought, model cache, provider auth, or undocumented model
  state.
- Native target-session conversion or resume.
- Recipient file copy/fork through AgentShare.
- Accounts, teams, email invites, billing, or permanent shares.
- Gemini, OpenCode, Cursor, or other adapters.
- Browser directly launching a terminal without an installed protocol handler.
- Embeddings, vector databases, generated summaries, or AgentShare-funded
  inference.
- Live collaboration or bundle mutation after publication.

## 2. Non-Negotiable Invariants

Every implementation step must preserve these invariants:

1. Relay never receives plaintext, decryption keys, provider credentials, or
   plaintext fingerprints.
2. Every share becomes unreadable through the relay no later than 72 hours after
   creation.
3. Creator sees and confirms the exact resource inventory before upload.
4. ACB and MCP surfaces contain no write, execute, network, or target-session
   mutation capability.
5. Recipient connection does not persist MCP configuration globally or inside an
   existing project, and the capability URL/key never enters argv or environment
   variables.
6. Unknown provider records are skipped with warnings, never guessed into
   trusted fields.
7. Archive parsing rejects path traversal, absolute paths, links, oversized
   output, and malformed manifests; recipient plaintext remains memory-only.
8. MCP responses are bounded, paginated, and carry source provenance.
9. Shared content is treated as untrusted data, never as AgentShare control
   instructions.
10. Repeated network operations are safe. Encryption keys and nonces are never
    reused for newly created shares.
11. Server-authoritative share ID, protocol version, creation time, expiry, and
    limits are authenticated as AES-GCM additional authenticated data (AAD).
12. A target launcher ships only after tests prove its documented flags prevent
    file writes, shell execution, and unrelated network tools in the temporary
    query session.

## 3. Technical Baseline

### Proposed stack

- Runtime: Node.js 22 or later.
- Language: TypeScript with strict mode.
- Package management: npm workspaces.
- Tests: Vitest plus fixture-driven contract and integration tests.
- Schema validation: Zod with emitted JSON Schema for ACB v1.
- Archive: deterministic ZIP using a pure JavaScript implementation.
- Crypto: Node Web Crypto AES-256-GCM with random 256-bit keys and random 96-bit
  nonces.
- MCP: official TypeScript MCP SDK over authenticated Streamable HTTP bound only
  to `127.0.0.1` for recipient sessions.
- Retrieval: pure JavaScript lexical/BM25 index built locally after decryption.
- Relay: Cloudflare Worker, R2 ciphertext storage, D1 metadata.
- Landing page: static assets served with restrictive headers; no analytics in
  v0.

TypeScript is selected because the same implementation can power `npx`
bootstrap, creator CLI, local MCP, crypto, Cloudflare Worker code, and
cross-platform tests. Native database dependencies are excluded from v0 to keep
`npx` predictable on Windows, macOS, and Linux.

### Intended repository shape

```text
AgentShare/
├── apps/
│   ├── relay/
│   └── web/
├── packages/
│   ├── contracts/
│   ├── acb/
│   ├── adapter-codex/
│   ├── adapter-claude/
│   ├── scanner/
│   ├── mcp/
│   ├── cli/
│   ├── integrations/
│   ├── connector/
│   ├── launcher-codex/
│   └── launcher-claude/
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── adr/
│   ├── protocol/
│   ├── security/
│   └── operations/
└── plans/
```

### Git and delivery mode

Pre-flight result on 2026-08-08:

- Git repository exists on branch `master`.
- Repository has no commits and no remote.
- `chat-transcript.md` is untracked.
- GitHub CLI is authenticated, but no GitHub repository is attached.

Until a remote exists, execute steps in direct mode and make one local commit
per step. Once a remote is attached, use the suggested branch per step, open one
PR per step, require CI, and squash merge. Never combine two blueprint steps
into one PR without recording a plan mutation.

## 4. Dependency Graph

```text
Step 1: Feasibility gates, foundation, executable contracts
  ├── Step 2: ACB, crypto, idempotency
  │     └── Step 6: Local MCP retrieval
  ├── Step 3: Codex adapter
  ├── Step 4: Claude adapter
  ├── Step 5: Scanner and final-payload review
  └── Step 7: Blind relay API and lifecycle
          └── Step 8: Landing page

Steps 2 + 3 + 4 + 5 + 7 have disjoint package ownership and can be developed
in parallel after Step 1. Their merges remain serial: each branch rebases and
regenerates the root lockfile before merge.

Step 9: Creator publishing CLI
  depends on Steps 2 + 3 + 4 + 5 + 7

Step 10: Creator Codex/Claude /share integrations
  depends on Steps 1 + 9

Step 11: Recipient connector core
  depends on Steps 2 + 6 + 7

Steps 10 + 11 can run in parallel because they own separate packages.

Step 12: Codex temporary query launcher
  depends on Steps 1 + 11

Step 13: Claude temporary query launcher
  depends on Steps 1 + 11

Steps 12 + 13 can run in parallel because they own separate packages.

Step 14: End-to-end security and compatibility hardening
  depends on Steps 8 + 10 + 12 + 13

Step 15: OSS release and public relay launch
  depends on Step 14
```

### Execution waves

| Wave | Steps         | Parallelism                                                    |
| ---- | ------------- | -------------------------------------------------------------- |
| 1    | 1             | Serial foundation                                              |
| 2    | 2, 3, 4, 5, 7 | Five package-isolated workstreams; serial merge/rebase         |
| 3    | 6, 8, 9       | MCP, web, and creator CLI use completed Wave 2 artifacts       |
| 4    | 10, 11        | Provider integrations and connector core own separate packages |
| 5    | 12, 13        | Provider launchers own separate packages                       |
| 6    | 14            | Integrated cross-platform hardening gate                       |
| 7    | 15            | Release gate                                                   |

## 5. Construction Steps

## Step 1: Feasibility Gates, Repository Foundation, and Executable Contracts

**Suggested branch:** `feat/01-feasibility-foundation-contracts`  
**Dependencies:** None  
**Parallel with:** None  
**Model tier:** Strongest. Contract errors propagate into every later step.

### Cold-start context

Repository currently contains only the source conversation and this blueprint.
First prove current Codex and Claude versions can register creator `/share`,
accept per-invocation MCP configuration, and enter an isolated query-only
session without persistent config. These are hard feasibility gates, not
assumptions. Then establish a strict TypeScript/npm workspace, freeze v0 product
boundaries, and define executable interfaces before production adapter, crypto,
or relay work.

### Tasks

1. Run disposable Codex and Claude capability spikes. Prove exact creator
   `/share` registration, temporary MCP injection, built-in tool restriction,
   empty-workspace launch, and no global config mutation on current versions.
2. Record commands, versions, outputs, and supported limits in
   `docs/adr/0001-host-capability-gates.md`. If either host cannot meet exact
   `/share` or query-only requirements, stop and request a product-scope
   decision before scaffolding implementation.
3. Create npm workspace structure shown in Section 3, including separate
   provider adapter, integration, and connector packages.
4. Configure strict TypeScript, ESLint, formatting, Vitest, build scripts, and
   package exports.
5. Set Node.js minimum version and add Windows, macOS, and Linux CI jobs.
6. Add Apache-2.0 license, contribution guide, security policy, and concise root
   README.
7. Decide publishable product/npm identity. Record result in
   `docs/adr/0002-product-package-identity.md`. Existing Python project named
   AgentShare must be considered. Keep executable name `agentshare` only if no
   collision blocks distribution.
8. Write `docs/protocol/acb-v1.md` covering manifest, normalized session events,
   resource inventory, inspectable final-payload review, limits, and version
   compatibility.
9. Write `docs/protocol/relay-v1.md` covering the authoritative metadata
   handshake, create, idempotent upload, download, metadata, revoke, and expiry
   state machine.
10. Define Zod contracts for ACB manifest, canonical session event, relay API
    payloads, error envelopes, and MCP tool responses.
11. Implement executable relay state-machine contract tests and client mocks.
    Steps 2 and 7 must both pass these tests; neither may independently redefine
    idempotency semantics.
12. Add sanitized minimal Codex and Claude fixture directories with provenance
    notes. Fixtures must contain no real credentials, private code, or personal
    data.
13. Add architecture decision records for Node/TypeScript, blind relay,
    no-inference retrieval, memory-only recipient plaintext, and authenticated
    loopback MCP.

### Required contract decisions

- ACB logical fingerprint derives from canonical manifest fields plus ordered
  resource hashes, independent of archive timestamps or encryption.
- Link shape is `https://<host>/s/<read-capability>#k=<base64url-key>`; symbolic
  fields are resolved by ADR 0002 and deployment config before implementation
  exits Step 1.
- Fragment key never appears in HTTP requests, server logs, HTML, or telemetry.
- Relay receives a random share ID, ciphertext hash, ciphertext size, expiry,
  and token digests only.
- Creator generates write and revoke secrets locally; relay stores only their
  digests.
- Creator requests a TTL; relay returns authoritative server creation/expiry
  metadata capped at 72 hours. Creator then encrypts with canonical share ID,
  protocol version, creation time, expiry, and limits as AES-GCM AAD.
- Final payload review allows inspection of every normalized field/resource
  after scanning and redaction, then confirms the canonical payload fingerprint.
  Inventory-only review is insufficient.
- Hard limits: 50 MiB ciphertext, 5 MiB per source file, 72-hour maximum expiry.

### Verification

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Validate emitted ACB and relay JSON Schemas against committed golden files. Run
CI on all three operating systems before exit.

### Exit criteria

- Workspace builds from clean clone.
- Both host feasibility gates pass with recorded commands and versions. Failure
  blocks all downstream steps.
- Contract docs and schemas agree.
- Executable state-machine contract tests cover
  create/upload/retry/revoke/expiry transitions.
- No unresolved naming, schema, crypto-envelope, host-isolation, or API
  placeholders remain.
- Later steps can import contracts without circular dependencies.

### Rollback

Revert foundation commit. No runtime state exists. If package identity changes
later, add a new ADR instead of rewriting ADR 0002.

## Step 2: Deterministic ACB, Crypto Envelope, and Local Idempotency

**Suggested branch:** `feat/02-acb-crypto`  
**Dependencies:** Step 1  
**Parallel with:** Steps 3, 4, 5, and 7  
**Model tier:** Strongest. Crypto and canonicalization require careful review.

### Cold-start context

Implement provider-neutral bundle assembly and authenticated encryption. Relay
must remain unable to identify equal plaintext bundles. Identical live bundle
reuse happens only through creator-local state.

### Tasks

1. Implement canonical JSON serialization and resource hash ordering from ACB
   v1.
2. Build deterministic ZIP archives with fixed metadata and sorted paths.
3. Reject duplicate normalized paths, path traversal, absolute paths, links,
   devices, and case-fold collisions.
4. Implement AES-256-GCM envelope using Web Crypto. Envelope carries version,
   random nonce, ciphertext, and tag; URL fragment carries only key material.
5. Bind canonical share ID, protocol version, server-authoritative
   creation/expiry, and limits as AES-GCM AAD. Any metadata substitution must
   fail authentication.
6. Add decrypt-and-parse-in-memory validation, maximum compressed size, maximum
   expanded size, resource count limits, and manifest checksum verification.
   Recipient APIs must not extract plaintext to disk.
7. Implement local registry with secure file permissions/ACLs. Registry maps
   logical fingerprint to live URL, expiry, ciphertext hash, and revoke secret.
8. Implement share reuse semantics: return live matching share; use `--new` to
   generate fresh key, nonce, ciphertext, and URL.
9. Implement idempotency primitives against Step 1 executable state-machine
   contracts.
10. Add deterministic archive golden tests and published crypto/AAD test
    vectors.
11. Document memory use: v0 may buffer at most the 50 MiB ciphertext ceiling for
    AES-GCM and in-memory archive operations.

### Verification

```powershell
npm test --workspace packages/acb
npm run test:fixtures --workspace packages/acb
npm run typecheck
```

Required negative tests:

- One-bit ciphertext mutation fails authentication.
- Wrong key fails without extracting files.
- Modified share ID, creation time, expiry, limits, or protocol version fails
  AAD authentication.
- Fresh encryption of same plaintext yields different ciphertext.
- Logical fingerprint remains stable for same selected content.
- ZIP traversal, symlink, duplicate path, oversized expansion, and malformed
  manifest all fail closed.
- Repeated registry writes remain atomic after simulated interruption.

### Exit criteria

- ACB round-trip preserves exact selected text bytes and canonical session
  events.
- Recipient round-trip creates no plaintext filesystem artifact.
- Relay-facing metadata contains no plaintext fingerprint or key.
- Crypto tests are independently reviewable and use no custom cryptographic
  primitive.

### Rollback

Disable ACB v1 reader/writer behind version dispatch and revert package. Never
reinterpret already-produced envelope version bytes.

## Step 3: Codex Session Adapter

**Suggested branch:** `feat/03-codex-adapter`  
**Dependencies:** Step 1  
**Parallel with:** Steps 2, 4, 5, and 7  
**Model tier:** Strongest. Local formats may evolve and contain sensitive
fields.

### Cold-start context

Read observable Codex CLI session records from supported local stores and
normalize them into ACB events. Do not write Codex sessions. Do not export auth,
hidden reasoning, environment snapshots, or unknown records by default.

**Write ownership:** `packages/adapter-codex/**` and Codex-only fixtures/docs.
Do not edit Claude adapter files or shared contracts. Contract changes require a
Step 1 plan mutation.

### Tasks

1. Define adapter interface: detect, list sessions, inspect metadata, stream
   normalized events, report warnings.
2. Discover active and archived Codex sessions using documented/current local
   paths plus explicit override for tests.
3. Parse supported JSONL record variants into message, tool call, tool result,
   plan, and visible metadata events.
4. Preserve source record IDs and timestamps for provenance.
5. Apply allowlist export policy. Unknown event types produce bounded warnings
   and are omitted.
6. Associate sessions with current repository using recorded working directory
   and normalized path comparison.
7. Support explicit session path for recovery and tests without broad filesystem
   scans.
8. Add fixtures for normal conversation, tool failures, interrupted records,
   archived sessions, Unicode, and evolving unknown fields.
9. Add adapter compatibility matrix keyed by tested Codex CLI version.
10. Add a read-only diagnostic command that reports detected sessions without
    exposing content.

### Verification

```powershell
npm test --workspace packages/adapter-codex
npm run test:fixtures --workspace packages/adapter-codex
npm run typecheck
```

Run a manual smoke test against a disposable Codex session. Compare exported
visible messages/tool records with source UI output. Inspect output for
credentials and hidden fields.

### Exit criteria

- Adapter lists and parses supported Codex fixtures deterministically.
- Malformed or unknown records never crash whole selection flow.
- Adapter performs no writes under Codex directories.
- Export allowlist is documented field-by-field.

### Rollback

Disable Codex adapter via capability detection. Existing ACB readers remain
unaffected because canonical schema is provider-neutral.

## Step 4: Claude Session Adapter

**Suggested branch:** `feat/04-claude-adapter`  
**Dependencies:** Step 1  
**Parallel with:** Steps 2, 3, 5, and 7  
**Model tier:** Strongest. Local formats may evolve and contain sensitive
fields.

### Cold-start context

Read observable Claude Code JSONL session records and normalize them into the
same canonical events as Codex. Maintain semantic parity without trying to make
provider-native histories identical.

**Write ownership:** `packages/adapter-claude/**` and Claude-only fixtures/docs.
Do not edit Codex adapter files or shared contracts. Contract changes require a
Step 1 plan mutation.

### Tasks

1. Implement Claude adapter behind the Step 1 interface.
2. Discover project sessions through supported/current Claude Code local paths
   plus explicit test override.
3. Parse user/assistant messages, visible tool use/results, plans, and persisted
   summaries.
4. Exclude auth, hidden reasoning, environment variables, hooks secrets, and
   unknown records by default.
5. Preserve source IDs, parent relationships, timestamps, and tool provenance
   when observable.
6. Associate sessions with repository path without leaking unrelated project
   names during selection.
7. Add fixtures matching Step 3 scenarios, including compaction records and
   subagent/tool events.
8. Add compatibility matrix keyed by tested Claude Code version.
9. Verify current `/share` plugin/skill invocation can identify active session.
   Record any host limitation in ADR rather than guessing.
10. Add read-only diagnostic output equivalent to Codex adapter.

### Verification

```powershell
npm test --workspace packages/adapter-claude
npm run test:fixtures --workspace packages/adapter-claude
npm run typecheck
```

Run a manual smoke test against a disposable Claude Code session and compare
exported visible records with CLI output.

### Exit criteria

- Canonical output passes same contract suite as Codex output.
- Provider-only fields cannot leak without explicit allowlist addition and test.
- Adapter never mutates Claude session storage.

### Rollback

Disable Claude adapter independently. No ACB or Codex behavior changes.

## Step 5: Scanner and Inspectable Final-Payload Review

**Suggested branch:** `feat/05-scanner-payload-review`  
**Dependencies:** Step 1  
**Parallel with:** Steps 2, 3, 4, and 7  
**Model tier:** Strongest for disclosure boundary; default for terminal review
UI.

### Cold-start context

Secret scanning must cover the final normalized plaintext, not only repository
files. This package receives generic ACB candidate resources through frozen Step
1 contracts, scans/redacts them, and presents every field for inspection before
encryption. It does not discover provider sessions or upload data.

**Write ownership:** `packages/scanner/**`, scanner fixtures, and payload-review
docs only.

### Tasks

1. Define candidate-resource stream covering file bytes, normalized session
   messages, tool calls/results, plans, Git status/diff, instructions, paths,
   titles, and manifest metadata.
2. Apply default path/type/size exclusions before content loading; reject
   binaries and links by default.
3. Integrate maintained secret rules, high-confidence key patterns, entropy
   detection, and structured credential detectors. Do not claim complete
   detection.
4. Support field-level redact, exclude-resource, and explicit override actions.
   Every action rebuilds candidate payload and invalidates previous
   confirmation.
5. Re-scan the fully normalized post-redaction payload, including generated
   manifest fields.
6. Build review UI that can inspect every field/resource, search findings, page
   large text, and export a local review report. Summary inventory alone cannot
   confirm upload.
7. Display canonical content fingerprint, counts, sizes, scanner rule versions,
   overrides, and exact exclusions at content confirmation. Relay-created
   transport metadata/AAD is explicitly outside this content fingerprint.
8. Require explicit confirmation bound to final fingerprint; any payload change
   requires new scan/review/confirmation.
9. Add `--dry-run` contract returning report without encryption or relay access.
10. Add fixtures with secrets in messages, tool output, Git diff, filenames,
    instructions, generated metadata, and split/encoded forms.

### Verification

```powershell
npm test --workspace packages/scanner
npm run test:fixtures --workspace packages/scanner
npm run typecheck
```

Required tests prove no candidate field bypasses scanner traversal, payload
changes invalidate confirmation, and overrides are explicit in encrypted
manifest metadata.

### Exit criteria

- Every final plaintext ACB field is inspectable and scanned before
  confirmation.
- Confirmation cryptographically references final logical fingerprint.
- Scanner false negatives are documented as residual risk; UI never labels
  payload "safe."

### Rollback

Disable publishing entirely if scanner/review package is unavailable. Never fall
back to inventory-only confirmation.

## Step 6: Local Read-Only MCP Retrieval

**Suggested branch:** `feat/06-local-mcp`  
**Dependencies:** Steps 1 and 2  
**Parallel with:** Steps 8 and 9 after their dependencies  
**Model tier:** Default for implementation; strongest for retrieval contract
review.

### Cold-start context

Recipient agent must interrogate a decrypted ACB without loading it wholesale
into model context. Build an authenticated loopback MCP server with bounded
lexical retrieval and no mutation tools.

### Tasks

1. Accept only an already decrypted, fully validated in-memory ACB object. Never
   index partial or filesystem-discovered content.
2. Build an in-memory pure-JavaScript BM25 index across selected text files and
   canonical events.
3. Implement tools: `get_overview`, `list_resources`, `search_context`,
   `read_file`, `read_session`, `search_events`, and `inspect_git`.
4. Add cursor pagination, line/event ranges, maximum result counts, maximum
   response bytes, and time budgets.
5. Return provenance with every result: resource path or session ID, event ID,
   timestamp, and line range.
6. Label returned content as untrusted shared data and keep tool metadata
   separate from resource text.
7. Reject path traversal, hidden temp paths, unmanifested resources, and
   malformed cursors.
8. Serve Streamable HTTP on a random port bound only to `127.0.0.1`, require a
   random per-run bearer token, validate Host/Origin, reject browser navigation,
   and stop with parent connector.
9. Keep resource bytes and index in memory. Never write decrypted content,
   snippets, or index to disk.
10. Add retrieval quality fixtures with known expected top results for exact,
    multi-term, and tool-error searches.
11. Add load tests at v0 limits and verify bounded memory/runtime.

### Verification

```powershell
npm test --workspace packages/mcp
npm run test:retrieval --workspace packages/mcp
npm run test:load --workspace packages/mcp
npm run inspect:fixture --workspace packages/mcp
```

### Exit criteria

- No MCP tool can write, execute, fetch network resources, or reveal unselected
  data.
- Non-loopback clients, missing/wrong bearer tokens, invalid Host/Origin, and
  requests after connector exit are rejected.
- Expected fixture queries return cited results within configured bounds.
- Server handles malformed and adversarial tool arguments without process
  escape.

### Rollback

Revert MCP package while retaining ACB tooling. Connector must refuse to launch
when required MCP protocol version is unavailable.

## Step 7: Blind Relay API, Storage, and Lifecycle

**Suggested branch:** `feat/07-relay-lifecycle`  
**Dependencies:** Step 1  
**Parallel with:** Steps 2, 3, 4, and 5  
**Model tier:** Strongest for threat model, API state machine, and concurrency.

### Cold-start context

Relay stores only ciphertext and operational metadata. It cannot search or
decrypt. Link path is a high-entropy read capability; fragment is decryption key
and never reaches server. D1 holds state, R2 holds blob.

### Tasks

1. Implement D1 schema: share ID, status, ciphertext size/hash, server
   creation/expiry, write-token digest, revoke-token digest, timestamps. No
   creator identity or plaintext fingerprint.
2. Implement Step 1 executable state machine: create, write-once idempotent blob
   upload, status, download, and idempotent revoke.
3. Require client-generated random share/write/revoke secrets with minimum
   entropy. Store only token digests.
4. On create, independently clamp requested TTL and return authoritative
   creation/expiry/limits used by client as AAD.
5. Make first successful upload immutable. Repeated matching operation/hash
   returns success without rewriting R2; mismatched or concurrent conflicting
   upload returns `409`.
6. Define crash-safe R2/D1 ordering and recovery for interrupted
   upload/finalize. Revocation/expiry status always wins every race.
7. Enforce 50 MiB body ceiling, content type, expiry ceiling, request timeouts,
   and bounded error bodies.
8. Deny download immediately after expiry. Add scheduled physical deletion from
   R2/D1; delayed cleanup must not restore access.
9. Add rate limiting, abandoned-create cleanup, and abuse controls that do not
   inspect bundle content.
10. Add `/health` without storage details and operational counters without share
    IDs.
11. Add local Wrangler/Miniflare tests, concurrent request tests, and an R2/D1
    cleanup test clock.
12. Document self-host setup, hard budget limits, deletion lag, incident
    response, and local-registry-loss revocation limits.

### Verification

```powershell
npm test --workspace apps/relay
npm run test:integration -- relay
npx wrangler dev
```

Capture requests/logs to verify no key, full URL, or plaintext fingerprint
appears. Verify expired/revoked shares always fail download during concurrent
upload/download/delete races.

### Exit criteria

- API is idempotent under retries and concurrent duplicate requests.
- Relay logs contain no secrets, full share URLs, or plaintext identifiers.
- Server-authoritative metadata exactly matches AAD contract consumed by Step 2.
- Deployment can be rolled back without changing ACB format.

### Rollback

Roll back Worker deployment. Keep D1 changes additive; never destructively
downgrade metadata. Disable new uploads while preserving valid downloads during
incident response unless confidentiality requires full shutdown.

## Step 8: Capability Landing Page

**Suggested branch:** `feat/08-landing-page`  
**Dependencies:** Steps 1 and 7  
**Parallel with:** Steps 6 and 9 after their dependencies  
**Model tier:** Default implementation; strongest privacy-header review.

### Cold-start context

The landing page explains a valid/expired/revoked share without seeing bundle
content. Browser fragment contains decryption key. Page must never send fragment
or full URL anywhere. Recipient command must not embed the URL because argv and
shell history are observable.

**Write ownership:** `apps/web/**` and web tests only.

### Tasks

1. Implement `/s/<id>` page with Codex and Claude command tabs.
2. Show version-pinned safe commands such as
   `npx --yes <resolved-package>@<version> connect --claude`; command then
   requests link through hidden TTY input.
3. Add separate copy-link action for intentional coworker forwarding. Never
   interpolate full URL into executable command.
4. Read fragment only to validate expected key syntax locally; do not store,
   render, report, or transmit it.
5. Fetch safe relay status by path ID only and display available, expired,
   revoked, oversized, or unavailable state.
6. Set `Referrer-Policy: no-referrer`, strict CSP,
   `X-Robots-Tag: noindex, nofollow`, no cookies, no third-party scripts, and no
   analytics.
7. Ensure errors, support links, clipboard events, browser beacons, source maps,
   and crash reports cannot include fragment/full URL.
8. Add responsive accessibility and copy-command browser tests without adding
   product marketing scope.

### Verification

```powershell
npm test --workspace apps/web
npm run test:browser --workspace apps/web
```

Capture all browser requests, navigation/referrer headers, console output,
storage, and rendered HTML while using a test fragment. Assert fragment absence
everywhere except browser address and explicit clipboard link action.

### Exit criteria

- Command argv contains no capability URL/key.
- Page works without account, cookie, analytics, or server-side decryption.
- Expired/revoked state cannot reconstruct or reveal prior link material.

### Rollback

Roll back static assets independently from relay API. Existing API clients
continue working without landing page.

## Step 9: Creator Publishing CLI

**Suggested branch:** `feat/09-creator-publishing-cli`  
**Dependencies:** Steps 2, 3, 4, 5, and 7  
**Parallel with:** Steps 6 and 8 after prerequisites  
**Model tier:** Strongest for publish state machine; default for terminal
selection UI.

### Cold-start context

Creator runs `agentshare share`. Native integrations arrive in Step 10 and
delegate here. Upload is forbidden until provider selection, final-payload
scan/review, and fingerprint-bound confirmation complete.

### Tasks

1. Implement source detection and explicit `--source codex|claude` override.
2. Implement searchable session selector scoped to current repository.
3. Implement file selector respecting `.gitignore`, default secret/binary
   exclusions, size limits, and explicit include/exclude controls.
4. Normalize all selected provider events/files/Git/instructions into candidate
   ACB resources, then invoke Step 5 scan/review package over the complete
   payload.
5. Require final content-fingerprint confirmation. Any selected resource,
   normalized field, redaction, or manifest-content change returns to
   scan/review. Requested TTL is transport metadata and does not alter content
   fingerprint.
6. Check local registry and relay status; reuse a matching live share unless
   `--new` is supplied.
7. For a new share, create relay record after content confirmation and receive
   authoritative creation/expiry/limits.
8. Show authoritative expiry/limits and require a second transport confirmation
   before encryption/upload. Cancel must idempotently revoke/abandon the empty
   relay record; no R2 object may exist.
9. Encrypt with authoritative metadata as AAD, then implement upload/status flow
   against Step 1 state-machine contracts with safe retry/resume messaging.
10. Store local control metadata securely; implement `agentshare list`,
    `agentshare revoke`, and `agentshare cleanup`.
11. Add `--dry-run` that produces complete post-normalization scanner/review
    report without relay creation.

### Verification

```powershell
npm test --workspace packages/cli -- creator
npm run test:integration -- creator-relay
```

Manual matrix:

- Shell share from Codex repository.
- Shell share from Claude repository.
- Repeated identical share returns same live URL.
- `--new`, changed selection, changed file, expiry, or revoke produces new URL.
- Cancel at preview causes no relay object.
- Cancel at authoritative transport confirmation leaves only an inaccessible
  cleanup/tombstone record and no R2 object.

### Exit criteria

- No upload path bypasses preview confirmation.
- Every uploaded ciphertext authenticates server-authoritative metadata as AAD.
- Creator can revoke any locally registered live share.
- Both source adapters create contract-valid ACBs through same workflow.

### Rollback

Revert creator CLI package. Existing hosted shares remain revocable through
stored local control metadata or documented relay admin procedure.

## Step 10: Creator Codex and Claude `/share` Integrations

**Suggested branch:** `feat/10-creator-integrations`  
**Dependencies:** Steps 1 and 9  
**Parallel with:** Step 11  
**Model tier:** Strongest. Host config mutation must be exact and reversible.

### Cold-start context

Step 1 already proved exact current host mechanisms. This step packages those
proven mechanisms into one-time global creator setup. `/share` must invoke Step
9 workflow; it must not duplicate parsing, scanning, crypto, or upload logic.

**Write ownership:** `packages/integrations/**` and provider integration
fixtures. Step 9 must expose stable integration hooks before this branch begins.

### Tasks

1. Implement idempotent `agentshare init`, `repair`, and `remove` around Step 1
   proven Codex/Claude extension surfaces.
2. Install exact `/share` entry for both hosts and pass explicit
   source/active-session hints to Step 9 CLI.
3. Use structured config parsers/APIs; never edit JSON/TOML/Markdown through
   broad string replacement.
4. Compute intended patch, show affected paths, make atomic backups, preserve
   unrelated settings/comments where host format permits, and verify host can
   load result.
5. Repeated init converges without duplicate commands/hooks/config. Update
   changes only AgentShare-owned entries.
6. Remove deletes only entries carrying AgentShare ownership marker and restores
   no stale backup over newer user edits.
7. Detect unsupported host versions before mutation and return Step 1 capability
   guidance.
8. Add integration package manifests without remote install scripts or
   unverified binary downloads.

### Verification

```powershell
npm test --workspace packages/integrations
npm run test:install --workspace packages/integrations -- codex
npm run test:install --workspace packages/integrations -- claude
```

Manual disposable-profile tests must run `/share` in active Codex and Claude
sessions, confirm Step 9 selector opens with correct session hint, run init
twice, update, repair, remove, and compare unrelated config byte-for-byte where
format allows.

### Exit criteria

- Exact `/share` works on compatibility-matrix versions for both hosts.
- Init/update/repair/remove are repeat-safe and preserve unrelated user config.
- No provider integration contains independent upload or crypto behavior.

### Rollback

Run ownership-aware remove, verify both hosts load, then revert integration
package. Never replace whole user config from backup.

## Step 11: Recipient Connector Core

**Suggested branch:** `feat/11-recipient-connector-core`  
**Dependencies:** Steps 2, 6, and 7  
**Parallel with:** Step 10  
**Model tier:** Strongest. Capability handling and plaintext lifetime are
security-critical.

### Cold-start context

Coworker runs the version-pinned command emitted by Step 8 without a URL
argument. Connector requests the full capability URL through a no-echo TTY
prompt. URL/key must never enter shell history, argv, environment variables,
logs, temp files, or child-process diagnostics.

### Tasks

1. Reject capability URLs supplied as positional args or environment variables.
   Implement hidden interactive input and an explicit no-echo stdin mode for
   automation.
2. Parse and validate URL in a redacting secret type whose
   stringification/debug/serialization never returns fragment.
3. Fetch authoritative metadata/ciphertext into bounded memory, verify
   size/hash, and authenticate metadata through AAD during decryption.
4. Validate and parse ACB entirely in memory. Build Step 6 index without
   plaintext archive, file, snippet, or key writes.
5. Start Step 6 MCP in same connector process on authenticated random loopback
   endpoint. Expose only endpoint plus short-lived random bearer token to
   launcher API.
6. Create a private AgentShare temp root only for later nonsecret launcher
   config/empty workspace markers. Validate ownership marker before cleanup.
7. Add orientation prompt identifying provenance and treating all shared content
   as untrusted data.
8. Stop MCP and zero/release key/plaintext buffers on normal exit, Ctrl+C,
   startup failure, and parent shutdown where runtime permits.
9. Document residual risk: OS swap, core dumps, recipient model processing, and
   force-kill/reboot are outside guaranteed secure deletion. Memory-only design
   minimizes persistent plaintext rather than promising impossible deletion.
10. Add `--inspect` mode showing safe relay/manifest metadata only after
    successful authenticated decryption.
11. Disclose that queried content is sent to recipient's chosen model provider
    and may appear in that provider's/local agent session records.

### Verification

```powershell
npm test --workspace packages/connector
npm run test:integration -- recipient-mcp
```

Run process/memory tests on Windows, macOS, and Linux. Inspect argv,
environment, logs, crash errors, temp root, and child API outputs for capability
URL/key/plaintext.

### Exit criteria

- Recipient needs Node/npm and target agent only; no prior AgentShare
  installation.
- Full share link/key never appears in argv, environment, logs, or filesystem.
- Decrypted ACB and retrieval index remain memory-only.
- Stopping connector removes MCP availability; secure-deletion residual risks
  are accurately documented.

### Rollback

Revert connector package and remove only AgentShare-owned temp roots validated
by marker/version files. Never recursively delete an unverified path.

## Step 12: Codex Temporary Query Launcher

**Suggested branch:** `feat/12-codex-launcher`  
**Dependencies:** Steps 1 and 11  
**Parallel with:** Step 13  
**Model tier:** Strongest. Codex permission/process isolation is a release gate.

### Cold-start context

Step 1 proved exact version-specific Codex launch commands. Step 11 supplies
only a launcher descriptor: authenticated loopback MCP endpoint, bearer token,
safe orientation prompt, and empty private workspace. Launcher never receives
capability URL/key/plaintext.

**Write ownership:** `packages/launcher-codex/**` and Codex launcher fixtures
only.

### Tasks

1. Generate temporary Codex MCP config containing loopback endpoint and per-run
   bearer only; restrict permissions and remove after child exit.
2. Use exact Step 1 per-invocation config, read-only sandbox, empty workspace,
   approval policy, MCP allowlist, and customization controls while preserving
   user auth.
3. Disable file writes, shell execution, browser/network tools, unrelated MCP
   servers, plugins, hooks, and project instructions. Prove behavior, not flag
   names.
4. Refuse unsupported Codex versions or failed isolation self-checks; never
   downgrade to unrestricted launch.
5. Preserve TTY, terminal resize, signals, and child exit codes on supported
   shells.
6. Pass orientation as initial visible prompt identifying source, expiry,
   query-only scope, and untrusted-data boundary.
7. Hash Codex user/global/project config before/after tests and require
   unchanged results.
8. Verify all AgentShare MCP reads work and access disappears when connector
   exits.

### Verification

```powershell
npm test --workspace packages/launcher-codex
npm run test:launcher -- codex
```

Include adversarial prompts requesting shell, writes, unrelated network/MCP,
config persistence, and recipient project access; all must fail while AgentShare
reads succeed.

### Exit criteria

- Codex meets query-only contract on declared versions.
- Config remains unchanged; key/plaintext never reaches child
  argv/env/config/prompt/logs.
- Unsupported behavior fails closed.

### Rollback

Disable affected Codex version in compatibility manifest and revert package.
Connector inspection remains available; never downgrade isolation.

## Step 13: Claude Temporary Query Launcher

**Suggested branch:** `feat/13-claude-launcher`  
**Dependencies:** Steps 1 and 11  
**Parallel with:** Step 12  
**Model tier:** Strongest. Claude permission/process isolation is a release
gate.

### Cold-start context

Step 1 proved exact version-specific Claude launch commands. Step 11 supplies
only a launcher descriptor: authenticated loopback MCP endpoint, bearer token,
safe orientation prompt, and empty private workspace. Launcher never receives
capability URL/key/plaintext.

**Write ownership:** `packages/launcher-claude/**` and Claude launcher fixtures
only.

### Tasks

1. Generate temporary Claude MCP/settings config containing loopback endpoint
   and per-run bearer only; restrict permissions and remove after child exit.
2. Use exact Step 1 flags, settings sources, MCP config, permission mode, and
   customization controls while preserving user auth.
3. Disable file writes, shell execution, browser/network tools, unrelated MCP
   servers, plugins, hooks, project instructions, and skills. Prove behavior,
   not flag names.
4. Refuse unsupported Claude versions or failed isolation self-checks; never
   downgrade to unrestricted launch.
5. Preserve TTY, terminal resize, signals, and child exit codes on supported
   shells.
6. Pass orientation as initial visible prompt identifying source, expiry,
   query-only scope, and untrusted-data boundary.
7. Hash Claude user/global/project config before/after tests and require
   unchanged results.
8. Verify all AgentShare MCP reads work and access disappears when connector
   exits.

### Verification

```powershell
npm test --workspace packages/launcher-claude
npm run test:launcher -- claude
```

Include adversarial prompts requesting shell, writes, unrelated network/MCP,
config persistence, and recipient project access; all must fail while AgentShare
reads succeed.

### Exit criteria

- Claude meets query-only contract on declared versions.
- Config remains unchanged; key/plaintext never reaches child
  argv/env/config/prompt/logs.
- Unsupported behavior fails closed.

### Rollback

Disable affected Claude version in compatibility manifest and revert package.
Connector inspection remains available; never downgrade isolation.

## Step 14: End-to-End, Security, and Compatibility Gate

**Suggested branch:** `test/14-e2e-security`  
**Dependencies:** Steps 8, 10, 12, and 13  
**Parallel with:** None  
**Model tier:** Strongest plus independent security reviewer.

### Cold-start context

This is the release-blocking integration step. Test all four source/target
combinations, threat boundaries, failure recovery, current CLI versions, and
free-tier operational limits. Findings are fixed in owning package; no waiver
for critical confidentiality, query-only isolation, or expiry failures.

### Tasks

1. Build sanitized fixture projects representing realistic code, failed
   attempts, tool output, dirty Git state, and instructions.
2. Exercise Codex-to-Codex, Codex-to-Claude, Claude-to-Codex, and
   Claude-to-Claude paths.
3. Add deterministic mock-agent harness for CI; run authenticated real-agent
   smoke tests manually or in protected optional CI.
4. Test Windows, macOS, and Linux with supported Node versions.
5. Threat-test malicious ZIPs, forged manifests, key tampering, hash mismatch,
   path traversal, symlinks, decompression bombs, oversized MCP args, malformed
   cursors, and prompt-injection content.
6. Test relay enumeration resistance, token entropy, overwrite conflicts,
   replayed create/upload/revoke, expiry races, deletion jobs, and log
   redaction.
7. Verify no plaintext/key/fingerprint reaches relay using captured HTTP traffic
   and server logs; mutate every AAD field and require decrypt failure.
8. Verify URL/key absence from argv/env/log/config, memory-only plaintext
   behavior, no global recipient config mutation, and AgentShare-owned temp
   cleanup under normal/abnormal exits.
9. Run dependency audit, license audit, secret scan, static analysis, and
   software composition analysis.
10. Benchmark 20 fixed evidence questions over synthetic fixtures. Require
    AgentShare top-5 evidence recall at least 90%, median citation-grounded
    target-agent answer rate at least 80% over three runs, and at least 15
    percentage points improvement over one generated Markdown handoff using same
    model/version.
11. Measure bundle build/connect time and peak memory at 1, 10, and 50 MiB.
12. Conduct adversarial security review against `docs/security/threat-model.md`;
    fix every critical/high finding or block release.

### Verification

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run test:security
npm audit --audit-level=high
npm run build
```

### Exit criteria

- All four handoff paths pass.
- Zero open critical/high security findings.
- Relay confidentiality and 72-hour access cutoff are demonstrated by tests.
- Retrieval benchmark meets explicit Task 10 thresholds with raw results
  committed.
- Compatibility matrix names exact tested Codex, Claude, Node, and OS versions.

### Rollback

Release remains blocked. Revert the owning feature step or reduce documented
compatibility; never waive core invariants.

## Step 15: Open-Source Release and Public Relay Launch

**Suggested branch:** `release/15-v0`  
**Dependencies:** Step 14  
**Parallel with:** None  
**Model tier:** Strongest for release gate; default for documentation polish.

### Cold-start context

Publish reproducible CLI packages and deploy optional relay while ensuring
protocol/self-host use does not depend on AgentShare-the-company. Existing
product/package name collisions must be resolved before publication.

### Tasks

1. Create/attach GitHub remote, set `main` default branch, and enable required
   CI/status checks.
2. Finalize product/npm identity from ADR 0002; verify npm, GitHub, domain, and
   trademark conflicts again immediately before release.
3. Publish ACB v1 spec, relay API spec, threat model, privacy boundary, and
   compatibility matrix.
4. Add reproducible npm release workflow with provenance, lockfile, changelog,
   signed tag, and least-privilege publishing token.
5. Deploy relay/web through infrastructure configuration committed without
   secrets.
6. Configure strict storage/request limits, alerts, hard budget ceiling,
   scheduled expiry cleanup, and emergency upload-disable switch.
7. Document public relay, self-host relay, local-only bundle, revocation,
   incident response, and data deletion semantics.
8. Publish demo using synthetic repository/session data only.
9. Run ten real coworker handoffs with consent; record failures by stage and
   retrieval quality without collecting shared contents.
10. Define v0 success metrics: successful create, successful connect, first
    cited answer, cleanup success, and zero confidentiality incidents.
11. Publish plugin roadmap only after v0 evidence. Recipient paste-link plugin
    remains phase 2.
12. Keep protocol, CLI, relay, and web source under Apache-2.0 with no
    proprietary dependency required for self-hosting.

### Verification

```powershell
npm ci
npm run verify:release
npm pack --dry-run
npm run test:installed-package
gh workflow run release-dry-run.yml
```

Post-deploy smoke test must create, connect, query, revoke, and verify
ciphertext deletion using synthetic data.

### Exit criteria

- Fresh machine can run documented creator setup and zero-install recipient
  connect.
- Public relay can be replaced by self-hosted relay without bundle conversion.
- Package provenance, source tag, and deployed commit match.
- Operational limits prevent accidental paid-scale exposure.

### Rollback

Disable uploads, roll back Worker/web deployment, deprecate broken npm version,
and publish fixed version. Do not unpublish packages or destroy forensic
operational metadata needed for incident response; metadata must still obey
retention policy.

## 6. Cross-Step Verification Invariants

Every step after Step 1 runs:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Every PR description or direct-mode commit note must state:

- Blueprint step implemented.
- Dependencies consumed.
- Invariants touched.
- Tests added and commands run.
- New persistent data/config/files.
- Rollback procedure.
- Known compatibility limits.

## 7. Adversarial Review Checklist

Reviewer must reject blueprint or implementation when any answer is unclear:

1. Can relay infer plaintext equality, obtain key, or reconstruct content?
2. Can a creator upload without inspecting every final normalized field/resource
   and confirming its fingerprint?
3. Can a recipient or malicious bundle escape temporary directory or invoke
   writes?
4. Can retries duplicate shares, corrupt state, or overwrite ciphertext?
5. Can expiry race permit access after 72 hours?
6. Can provider format drift silently omit or misclassify sensitive records?
7. Can full links/fragments leak through argv, environment variables, logs,
   referrers, process errors, shell history guidance, or analytics?
8. Can temporary MCP config persist or alter existing target-agent config?
9. Can one MCP call flood model context or exhaust memory/CPU?
10. Can a compromised shared file instruct the recipient agent to ignore trust
    boundaries?
11. Can package install scripts mutate unrelated configuration or execute
    unreviewed downloads?
12. Can public relay usage exceed free limits without hard stop?
13. Can relay metadata substitution bypass AAD or extend access beyond
    server-clamped expiry?
14. Can target Codex/Claude reach write, shell, unrelated MCP, browser, or
    network tools despite launcher flags?
15. Can recipient plaintext reach disk, swap/core dumps, or crash artifacts, and
    are residual limits stated honestly?

## 8. Anti-Pattern Catalog

Do not introduce:

- Raw provider-log pass-through presented as a stable interchange format.
- Deterministic encryption, reused nonce, custom cipher, or server-side key
  escrow.
- Plaintext content hash sent to relay for deduplication.
- Hosted MCP that requires relay-side decryption.
- Automatic upload before selection/preview.
- Permanent recipient MCP configuration for a temporary share.
- Capability URL/key in command arguments, environment variables, temp config,
  logs, or telemetry.
- Decrypted bundle, retrieval index, snippets, or key persisted to disk.
- Browser promises to launch terminal without installed protocol handler.
- Regex-only secret scanning marketed as complete protection.
- Native database dependency that breaks `npx` portability.
- Unbounded archive extraction, search results, tool responses, or filesystem
  scans.
- Provider-native target-session writes in v0.
- Shared content injected into system instructions without data boundaries.
- Destructive installer/uninstaller rewrites of Codex or Claude config.
- Provider version assumptions without fixtures and compatibility declarations.
- Analytics, third-party scripts, or referrer leakage on share pages.
- "Free forever" claims without relay limits and self-host escape path.

## 9. Plan Mutation Protocol

This blueprint is append-audited once execution begins.

### Split a step

1. Keep original step ID as umbrella.
2. Add lettered children, for example `8A` and `8B`.
3. Move tasks; do not duplicate them.
4. Update dependencies, waves, and exit criteria.
5. Record reason in Mutation Log.

### Insert a step

1. Use nearest preceding ID plus letter.
2. Define dependencies and rollback before work begins.
3. Update every downstream cold-start brief affected.
4. Record reason in Mutation Log.

### Reorder

Reorder only when dependency graph remains acyclic and file ownership does not
create unsafe parallel writes. Record old/new wave and reason.

### Skip

Skip only an optional task inside a step and outside invariants. Record evidence
that downstream exit criteria remain satisfiable. Steps 1 through 15 are all
required for v0.

### Abandon

Record incomplete artifacts, cleanup required, persistent state created, and
safe rollback. Never leave upload endpoints, npm releases, or creator
integrations active without ownership.

### Mutation Log

| Date       | Change                                                  | Reason                                                                             | Dependency impact                                                                                             | Approved by           |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------- |
| 2026-08-08 | Initial blueprint                                       | User requested multi-session build plan                                            | Initial graph                                                                                                 | Pending user review   |
| 2026-08-08 | Expanded 10 steps to 14 and rewrote security boundaries | Strongest-model adversarial review found one critical and ten high issues          | Split relay/web/scanner/integrations/connector/launchers; added AAD and feasibility gates                     | Blueprint review gate |
| 2026-08-08 | Expanded 14 steps to 15; added two-stage confirmation   | Recheck found authoritative AAD sequencing ambiguity and combined launcher PR risk | Split Codex/Claude launchers; content confirmation now precedes separate authoritative transport confirmation | Blueprint review gate |

## 10. Adversarial Review Record

- Reviewer: strongest available model, independent planner role.
- Initial result: one Critical and ten High findings. Main defects were
  capability URL in argv, unproven target isolation, unsafe parallel package
  ownership, incomplete scan scope, weak payload review, missing AAD binding,
  oversized PRs, assumed `/share` support, and impossible secure-deletion claim.
- First recheck: two High findings remained. Content confirmation conflicted
  with later server-authoritative AAD, and combined provider launchers were
  still too broad.
- Final result: `Gate: PASS`. No Critical or High execution-plan defects
  remained after two-stage confirmation and separate Codex/Claude launcher
  steps.

## 11. Research References

- MCP transport and security:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- Cloudflare R2 pricing/limits: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Workers limits:
  https://developers.cloudflare.com/workers/platform/limits/
- OpenAI Codex source: https://github.com/openai/codex
- Claude Code CLI and MCP docs:
  https://docs.anthropic.com/en/docs/claude-code/cli-usage
- AI Sessions MCP: https://github.com/yoavf/ai-sessions-mcp
- Cross Agent Session Resumer:
  https://github.com/Dicklesworthstone/cross_agent_session_resumer
- Existing AgentShare project: https://github.com/devashar13/agentshare
- AICTX: https://github.com/oldskultxo/aictx

## 12. Definition of Done

AgentShare v0 is done only when a creator can select context from a real Codex
or Claude session, inspect/scan every final normalized field, confirm its
content fingerprint, separately confirm server-authoritative expiry/limits,
encrypt with that metadata as AAD, receive a maximum-72-hour link, and send it
to a coworker. Coworker runs one version-pinned zero-prior-install command,
enters link through hidden input, then opens a proven query-only temporary Codex
or Claude session that retrieves cited evidence. Relay cannot decrypt/correlate
plaintext; recipient plaintext/index/key remain memory-only; temporary nonsecret
config is removed on exit; OS swap/core-dump residual risk is documented.
