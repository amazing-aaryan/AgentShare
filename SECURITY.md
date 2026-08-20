# Security Policy

AgentShare is a public beta and does not yet provide a production security
guarantee. Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/amazing-aaryan/AgentShare/security/advisories/new),
not a public issue.

## Supported Versions

Only the latest published release receives security fixes. Until v0.2.0 is
published, that remains v0.1.10.

Do not include secrets, capability URLs, decrypted bundles, or private source in
reports. Include affected version, reproducible steps using synthetic data, and
the expected impact.

## v0.2.0 candidate invariants

The v0.2.0 collaborative-environment implementation is unreleased while its
release gate is being completed. Its intended security invariants are:

- Environment manifests, workspace resources, local search indexes, and proposed
  changes are encrypted on client devices. The relay receives ciphertext plus
  operational metadata and capability digests.
- Recipient environment links carry only read/decryption material and, when the
  creator enables proposals, a proposal capability. Update, inbox, and revoke
  capabilities plus the proposal private key stay on the creator device.
- Shared paths are workspace-relative. Snapshot discovery never intentionally
  crawls above the current project root, never dereferences symlinks, and applies
  Git ignore rules, AgentShare exclusions, and secret scanning before publish.
- A recipient never gets write access to the creator workspace. Recipient changes
  are deterministic create/replace/delete proposals encrypted to the creator and
  tied to an exact base revision/file hash.
- Proposal approval re-validates revision identity, file hashes, path containment,
  symlink/regular-file rules, and secret scanning immediately before mutation.
- Local proposal application uses an encrypted rollback journal. A revision
  produced by an approved proposal remains resumable until the relay commit and
  proposal terminal status have both succeeded.
- Recipient questions and proposal generation run in a separate reviewed
  Codex/Claude child process. Built-in filesystem, shell, network/web, user
  skills, plugins/apps, and unrelated MCP servers are unavailable; the child can
  use only AgentShare's local controlled MCP surface.
- The recipient cache stores encrypted manifests, blobs, and indexes with
  restrictive local permissions where supported. Plaintext is reconstructed only
  for controlled local read/search operations and model context.
- Environment create/upload traffic uses the same public-relay admission/rate
  limiting infrastructure as v1. Retained environment ciphertext is charged to
  the creator reservation, including proposal ciphertext submitted by recipients.
- Expiry and creator revocation invalidate future relay access. They cannot erase
  data that a recipient or model provider already received.

The default v2 one-paste flow has an explicit privacy trade-off: when UserB
pastes the full bearer URL into a hosted agent conversation, that model provider
may receive the URL. The `/e/` page documents a maximum-privacy alternative for
users who need to keep bearer material out of hosted conversation text.

See `docs/security/environment-threat-model.md` for the v2 threat model.

## v0.1.10 invariants

Security invariants for v0.1.10 new-format links:

- Encryption and decryption happen on clients.
- Newly created links use an AgentShare-controlled handoff origin that is
  independent from the ciphertext relay. A custom relay does not serve the
  JavaScript that reads the capability fragment.
- The read capability and encryption key remain in the URL fragment. Browsers do
  not transmit that fragment in the HTTP request to either the handoff server or
  the relay. The trusted handoff page reads the fragment locally in browser
  JavaScript and does not send the encryption key to the relay.
- The selected relay origin is non-secret link metadata. The relay stores
  ciphertext and capability digests, never conversation plaintext, decryption
  keys, or raw upload/read/revoke capabilities.
- Recipient plaintext, keys, and indexes remain memory-only.
- Host launchers fail closed when query-only isolation cannot be established.
- Untrusted terminal output is stripped of terminal and bidirectional control
  characters before display.
- Public relay admission uses a pseudonymous source identity digest, per-source
  active-share limits, and short provisional reservations.

Legacy links without an explicit `relay=` parameter are parsed for compatibility
by treating the link origin as the relay origin. Those relay-origin links retain
the older v0.1.9 browser trust assumption: JavaScript served by that relay can
read the URL fragment in the browser. Do not use an untrusted custom relay with
a legacy-format link.

## Local Residual Risks

- The local relay is volatile, process-local, and not production hardened.
- Creator state stores live links and revocation capabilities in mode-0600 local
  files; Windows protection inherits the user's directory ACL.
- Decrypted recipient context exists in process memory and may appear in OS swap
  or crash dumps. AgentShare does not claim secure memory erasure.
- Codex may enumerate skill metadata during startup, but AgentShare disables its
  shell, unified exec, patch, JavaScript, code-mode, search, app, and plugin tool
  surfaces before handing it untrusted context. Launchers fail closed on
  unreviewed Codex or Claude versions.
- Capability links can leak through clipboard managers, screenshots, browser
  extensions, screen recording, or compromised endpoints. The v1 trusted handoff
  page immediately removes query and fragment data from visible history, uses
  `no-referrer`, loads no third-party assets, and sends no analytics.
- Compromise of the trusted AgentShare v1 handoff origin could replace the browser
  JavaScript and expose capability fragments. Separating the handoff origin from
  custom ciphertext relays removes relay-controlled page code from the v0.1.10
  threat model; it does not eliminate compromise of the trusted handoff service
  itself.
- Secret scanning covers known credential formats in text plus ASCII, UTF-8,
  UTF-16LE, and UTF-16BE views of binary resources. It cannot inspect encrypted,
  compressed, or unknown encodings.
- Creator review is exact for normalized/redacted text. Binary resource bytes are
  not rendered byte-for-byte in the terminal; binary resources are inventoried
  by media type, byte length, and SHA-256, and a suspected secret found in the
  supported binary text views blocks sharing. Omit binary resources you cannot
  independently trust.
- Per-source capacity controls increase the cost of relay exhaustion but cannot
  eliminate distributed abuse across many source addresses.
- Hashing source addresses minimizes stored quota data; it does not anonymize
  low-entropy IP addresses or hide them from Cloudflare.
