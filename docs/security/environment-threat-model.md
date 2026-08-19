# AgentShare v2 Environment Threat Model

## Security boundaries

AgentShare v2 deliberately separates four principals:

1. **UserA / creator runtime** — may read the current agent transcript and the selected project root, encrypt revisions, receive proposals, and apply an approved proposal to UserA's real workspace.
2. **Relay** — stores ciphertext and operational metadata only. It does not receive environment master keys or proposal plaintext.
3. **UserB / recipient runtime** — holds read capability material and, optionally, a proposal capability. It can decrypt the shared snapshot locally but has no capability that writes UserA's filesystem.
4. **Restricted recipient worker** — a child Codex/Claude process launched in an empty temporary workspace with host project filesystem/network/shell/user-skill surfaces disabled. Its only collaboration surface is the local AgentShare MCP server.

## Workspace snapshot policy

AgentShare never crawls above the current session workspace root. Paths in an environment are normalized relative paths. `.git`, `.agentshare`, dependency/build caches, credential-oriented filenames/directories, unsupported file types, escaping symlinks, and oversized files are excluded before publication. `.gitignore` is respected for Git projects and `.agentshareignore` adds AgentShare-specific exclusions.

Text resources and conversation content pass through the secret scanner before encryption. Suspicious binary resources fail closed rather than being silently redacted.

## Recipient isolation

The main recipient agent does not receive a plaintext checkout of UserA's project. AgentShare caches encrypted manifests, blobs, and its local search index. Plaintext is materialized only in process memory for controlled read/search/MCP responses.

The restricted worker gets only these AgentShare MCP capabilities:

- environment metadata;
- shared file listing;
- shared evidence search;
- read a shared file;
- read shared conversation events;
- when allowed, stage proposal create/replace/delete operations;
- review staged proposal operations;
- submit the encrypted proposal.

No AgentShare MCP tool executes shell commands, performs network requests, opens UserB's project filesystem, or applies changes to UserA.

## Proposal approval

A proposal is advisory until UserA explicitly approves it. Approval preflight verifies:

- the proposal base revision is still the creator's current revision;
- each replace/delete base hash still matches UserA's current file;
- all paths remain inside the owned workspace and do not traverse symlinks;
- targets are regular files and create targets do not already exist;
- new content hashes match their proposal descriptors;
- proposed content does not introduce scanner-detected secrets.

AgentShare writes an encrypted rollback journal before mutation. If any local operation fails, it attempts to restore the exact previous file contents and modes before surfacing the failure. Only after local application succeeds does AgentShare publish the next encrypted environment revision and mark the proposal accepted.

## Direct-paste privacy trade-off

The default v2 recipient UX lets UserB paste the full capability link into a hosted agent. Because the URL appears in the user's message, that model provider may receive the capability URL. This is an explicit product trade-off for the one-paste experience.

The web handoff page therefore also documents a **Maximum privacy** path: keep the bearer link out of hosted model conversation text and provide it directly to AgentShare's hidden/local input instead.

## Residual risks

- Anyone holding the full recipient link before expiry can read the environment and, if `p` is present, submit proposals.
- A compromised creator or recipient endpoint can capture plaintext or capability material.
- Secret detection is defense in depth and cannot prove absence of every credential or sensitive datum.
- Shared content can contain malicious prompt text. Restricted workers reduce its blast radius but do not make shared claims trustworthy.
- An approved malicious proposal becomes a real creator workspace mutation because approval is the creator authorization boundary.
- Expiry/revocation prevents future relay access; it cannot erase plaintext already seen by a recipient process or model provider.
