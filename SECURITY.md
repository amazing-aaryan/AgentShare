# Security Policy

AgentShare is a public beta and does not yet provide a production security
guarantee. Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/amazing-aaryan/AgentShare/security/advisories/new),
not a public issue.

The security model follows the project vision in
[`docs/VISION.md`](docs/VISION.md): AgentShare is a free, open, capability-based
transport for agent context, not an account-based workspace or central plaintext
knowledge store.

Repository administrators should also follow
[`docs/operations/repository-security.md`](docs/operations/repository-security.md)
for branch protection, secret-scanning, release-immutability, and package
verification controls.

## Core Trust Boundary

The core handoff is intentionally authorized by possession of the complete
capability link rather than by an AgentShare account, company membership, or
identity provider.

That enables handoffs across people, machines, communities, and companies
without a shared control plane, but it also means the complete link is a secret.
Anyone who obtains it may be able to read the share until it expires or is
revoked. Current revocation invalidates all readers of that link at once.

The normal AgentShare relay is designed so it does not need conversation or
workspace plaintext or the encryption key. This guarantee applies to AgentShare
transport infrastructure, not to the recipient's chosen model provider: after
local decryption, selected evidence excerpts are submitted through the
recipient's Codex or Claude account when they ask the target agent a question.

No future account, workspace, analytics, or knowledge feature should silently
weaken this trust boundary. A change that requires central plaintext processing
or materially changes capability semantics requires explicit security review and
an ADR.

## Supported Versions

Only the latest published stable AgentShare release receives security fixes.
Repository and release-candidate code is not a published security release until
its documented release gates pass.

Do not include secrets, capability URLs, decrypted bundles, or private source in
reports. Include affected version, reproducible steps using synthetic data, and
the expected impact.

## Capability-link Invariants

Security invariants for current split-origin links:

- Encryption and decryption happen on clients.
- Newly created links use a trusted handoff origin that is independent from the
  ciphertext relay. A custom relay does not serve the JavaScript that reads the
  capability fragment.
- The selected relay origin is non-secret `relay=` query metadata.
- V1 `/s/` fragments contain the read capability and share encryption key.
- V2 `/e/` fragments contain the read capability and environment master key and
  may also contain a proposal capability for read-plus-propose access.
- Browsers do not transmit URL fragments in HTTP requests. The trusted handoff
  page reads fragment material locally and does not send encryption keys to the
  relay.
- Creator-only v2 update, inbox, revoke, and proposal-private-key material stays
  in local creator state and is never placed in the recipient URL.
- The relay stores ciphertext and capability digests, never conversation or
  workspace plaintext, decryption keys, or raw bearer capabilities.
- Cross-origin browser access to the production relay is deliberately narrow;
  privileged create, upload, update, proposal-inbox, revoke, and ciphertext
  routes are not exposed as a general browser API.
- Recipient plaintext, keys, indexes, and decrypted workspace views remain
  local to the recipient process/cache boundary rather than becoming relay
  plaintext.
- Host launchers fail closed when the reviewed recipient-isolation contract
  cannot be established.
- Creator publication fails closed when interactive selection/review cannot be
  obtained; host integrations must not invent a `--yes` bypass.
- Untrusted terminal output is stripped of terminal and bidirectional control
  characters before display.
- Public relay admission uses pseudonymous source identity digests, bounded
  capacity, and rate limits.

Legacy links without an explicit `relay=` parameter are parsed for compatibility
by treating the link origin as the relay origin. Those relay-origin links retain
the older v0.1.9 browser trust assumption: JavaScript served by that relay can
read the URL fragment in the browser. Do not use an untrusted custom relay with
a legacy-format link.

## Capability Security

AgentShare deliberately does not require recipient identity for the base
protocol. The consequence is simple: capability secrecy is access control.

- Send a link only through a channel appropriate for the sensitivity of the
  reviewed context.
- Do not paste complete links into issues, logs, analytics, shell history,
  screenshots, public chat, or bug reports.
- Prefer shorter TTLs for sensitive or one-off handoffs.
- Revoke a share or environment if you suspect the link was copied to the wrong
  place.
- Remember that forwarding the complete link forwards access.

Adding identity-bound or per-recipient schemes in compatible third-party tools
is possible, but the base AgentShare protocol must remain usable without an
account or shared organization.

## CLI Update Trust Boundary

Creator installations may perform a best-effort HTTPS GET to the canonical
`amazing-aaryan/AgentShare` GitHub Releases API at most once per 24 hours after
a successful creator command. The request contains no conversation text,
capability URL, encryption key, relay state, project path, or share metadata. It
identifies the installed AgentShare version in the User-Agent. Set
`AGENTSHARE_NO_UPDATE_CHECK=1` to disable passive checks entirely.

Passive checks never install code and failures are ignored by the creator
command that triggered them. `agentshare update --check` explicitly performs a
fresh check. Only `agentshare update` installs a release.

The updater accepts only exact stable `vMAJOR.MINOR.PATCH` tags returned by the
fixed repository endpoint. Drafts, prereleases, malformed versions, and
downgrades are rejected. The immutable GitHub tarball URL is derived locally
from the validated version; AgentShare does not execute a URL or command
supplied by a release body. npm is invoked without a shell. After installation,
AgentShare uses the running Node executable and the same CLI entrypoint to
verify the exact new version before invoking the new CLI's `repair` command.

The update trust chain still includes GitHub HTTPS, control of the AgentShare
repository/releases, npm's local installation behavior, and the creator device.
Release checksum or signature verification is not yet part of this updater. A
compromise of the canonical release account could therefore publish malicious
code under a valid stable tag; explicit user invocation limits installation but
does not remove that supply-chain risk. See ADR 0004 for the decision record.

## Local Residual Risks

- The local relay is volatile, process-local, and not production hardened.
- Creator state stores live capability links and creator-only update, inbox, and
  revocation material in local mode-0600 files where supported; Windows
  protection inherits the user's directory ACL.
- The update cache stores only a last-check timestamp and latest stable version
  in `~/.agentshare/update-check-v1.json`; malformed cache content is ignored
  and refreshed rather than trusted as executable data.
- Decrypted recipient context exists in process memory and may appear in OS swap
  or crash dumps. AgentShare does not claim secure memory erasure.
- Codex may enumerate skill metadata during startup, but AgentShare disables its
  shell, unified exec, patch, JavaScript, code-mode, search, app, and plugin
  tool surfaces before handing it untrusted context. Launchers fail closed on
  unreviewed Codex or Claude versions.
- Capability links can leak through clipboard managers, screenshots, browser
  extensions, screen recording, messaging systems, or compromised endpoints.
  The handoff page uses `no-referrer`, loads no third-party assets, sends no
  analytics, and removes sensitive fragment material from visible history where
  browser execution is required.
- Compromise of the trusted AgentShare handoff origin could replace browser
  JavaScript and expose capability fragments. Separating the handoff origin from
  custom ciphertext relays removes relay-controlled page code from the
  split-origin threat model; it does not eliminate compromise of the trusted
  handoff service itself.
- Secret scanning covers known credential formats in text plus ASCII, UTF-8,
  UTF-16LE, and UTF-16BE views of binary resources. It is heuristic and cannot
  guarantee detection of every provider token or inspect encrypted, compressed,
  or unknown encodings. Repository-level GitHub secret scanning is an
  independent defense and must remain enabled.
- Creator review is exact for normalized/redacted text. Binary resource bytes
  are not rendered byte-for-byte in the terminal; binary resources are
  inventoried by media type, byte length, and SHA-256, and a suspected secret
  found in the supported binary text views blocks sharing. Omit binary resources
  you cannot independently trust.
- Per-source capacity controls increase the cost of relay exhaustion but cannot
  eliminate distributed abuse across many source addresses.
- Hashing source addresses minimizes stored quota data; it does not anonymize
  low-entropy IP addresses or hide them from Cloudflare.

## Security Direction

Broader host support must not be added merely because an agent can consume a
prompt. Each recipient integration must prove the required isolation properties
before being supported. New creator adapters must preserve explicit selection
and review rather than crawl additional workspace data silently.

The long-term goal is wider agent interoperability with the same narrow trust
boundary: open context format, local review, local encryption, blind transport,
local decryption, and a safely constrained recipient agent.
