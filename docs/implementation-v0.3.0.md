# v0.3.0 implementation handoff

Status: local candidate implemented and exercised; **not released or fully
certified**. Working repository: `C:\Users\aarya\Desktop\AgentShare\source`.
Origin remains `https://github.com/amazing-aaryan/AgentShare.git`.

| Plan                 | Implemented                                                                                                                                          | Remaining acceptance                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 01 Recipient MCP     | Exact per-mode tools, Codex 0.147.0, trusted success/failure receipts, pinned proposal base                                                          | Published-artifact certification                                                                          |
| 02 Scanning          | Strict MIME/UTF-8, lossless clean bytes, binary-secret rejection, safe paths/diagnostics                                                             | Broader adversarial review remains useful                                                                 |
| 03 Drafts/state      | Encrypted immutable drafts, real owner approval boundary, expiry binding, locked exact recovery, state migration/tombstones, Windows owner-only ACLs | Production operational recovery exercises                                                                 |
| 04 Sessions/terminal | Exact session IDs, explicit relocation, retained-draft review, scoped management                                                                     | Real terminal PTY release flow                                                                            |
| 05 Proposals         | Authenticated shared base plus approved operations only; private encrypted journal and guarded rollback                                              | Published-artifact certification                                                                          |
| 06 Chat              | Creator MCP, native form protocol, separate apply/revoke consent, managed config/skills                                                              | Actual Codex app confirmation and reload; no claim of current-session availability                        |
| 07 Evidence          | Strict offline contract/hash validator and packaged real-agent loopback diagnostic                                                                   | Trusted public/native/terminal collection; attachment semantics are not attested by the offline validator |
| 08 Release           | Candidate metadata 0.3.0 and retained tested archive                                                                                                 | Anonymous published download, exact-artifact gates, promotion/pins, verified local CLI/skill rollout      |

## Verified local handoff

`npm run test:handoff:local` used an isolated installation of the packaged CLI,
a loopback relay, synthetic content and real authenticated Codex. All seven
stages passed: creator prepare/review/commit, recipient bootstrap, real file and
conversation MCP reads, proposal submission, owner approval without unrelated
file publication, refreshed revision, and revoke/denial. Synthetic protocol
confirmations were used; this does **not** prove native human UI consent.

Latest report: `artifacts/local-packaged-handoff.json`. Retained archive:
`artifacts/agentshare-0.3.0-ff62c0780fc6.tgz`. SHA-256:
`ff62c0780fc68867cffd2e253f8a008c2a694e257b2d15736ef300752926c61a`. Size: 154248
bytes. These ignored local artifacts are not published assets.

Typecheck/lint, formatting, package installation smoke tests, owner-only Windows
ACL checks, v2 capability-preserving migration, and consent rejection tests
passed. Consent rejection covers unsupported hosts, decline, cancel, timeout,
fabricated approval arguments and replies for another request.

Final full suite: 325 passing tests across 61 suites; eight opt-in tests
skipped. Offline evidence validator: 86 passing synthetic cases. Expanded
creator consent suite: six passing cases, run separately after the full suite.

## Next gate

Register this candidate as a temporary development MCP server for actual Codex
app approval testing, preserving the existing configuration and installed CLI.
Reload if supported, otherwise restart Codex. Verify actual native confirmation
before treating chat creation as supported. Then collect the terminal and chat
journeys against the exact anonymously downloaded candidate and public Workers.
Do not promote a self-authored contract fixture or the loopback diagnostic.

No commits, pushes, releases, deployments, public shares, global CLI replacement
or live skill/config changes were made during this implementation. Immutable
v0.2.0 and deployed pins remain unchanged. Claude and other platforms remain
unverified. Three implementation workers were integrated and closed; none remain
open.

Private-state recovery fails closed for abandoned locks and legacy proposal
journals; do not remove them while any writer is active. Filesystem checks do
not provide an OS-wide atomic compare-and-swap against unrelated local writers.

## Native registration checkpoint — 2026-08-28

User approved temporary candidate registration. The exact retained archive is
installed under `artifacts/native-mcp-ff62c0780fc6`, with isolated test state.
`agentshare_creator` now appears in the user Codex config. Original config is
backed up at `C:\Users\aarya\.codex\config.toml.agentshare-backup`; unrelated
config, installed CLI and creator skill remain unchanged.

Read-only startup, ping and discovery of all nine creator tools passed. The
current task still has no creator MCP tools. Reload MCP servers if supported,
otherwise restart Codex and continue this conversation. Native confirmation
testing is still pending; registration alone is not certification.

Local receipt: `artifacts/native-mcp-registration.json`. No share was created.
For rollback, remove only the managed AgentShare MCP block, preserving later
config edits; do not blindly restore the entire backup.
