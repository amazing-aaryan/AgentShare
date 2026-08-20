# Security Policy

AgentShare is a public beta and does not yet provide a production security
guarantee. Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/amazing-aaryan/AgentShare/security/advisories/new),
not a public issue.

## Supported Versions

Only the latest published `0.1.x` release receives security fixes.

Do not include secrets, capability URLs, decrypted bundles, or private source in
reports. Include affected version, reproducible steps using synthetic data, and
the expected impact.

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

## CLI Update Trust Boundary

Creator installations may perform a best-effort HTTPS GET to the canonical
`amazing-aaryan/AgentShare` GitHub Releases API at most once per 24 hours after a
successful creator command. The request contains no conversation text,
capability URL, encryption key, relay state, project path, or share metadata. It
identifies the installed AgentShare version in the User-Agent. Set
`AGENTSHARE_NO_UPDATE_CHECK=1` to disable passive checks entirely.

Passive checks never install code and failures are ignored by the creator command
that triggered them. `agentshare update --check` explicitly performs a fresh
check. Only `agentshare update` installs a release.

The updater accepts only exact stable `vMAJOR.MINOR.PATCH` tags returned by the
fixed repository endpoint. Drafts, prereleases, malformed versions, and
downgrades are rejected. The immutable GitHub tarball URL is derived locally
from the validated version; AgentShare does not execute a URL or command supplied
by a release body. npm is invoked without a shell. After installation, AgentShare
uses the running Node executable and the same CLI entrypoint to verify the exact
new version before invoking the new CLI's `repair` command.

The update trust chain still includes GitHub HTTPS, control of the AgentShare
repository/releases, npm's local installation behavior, and the creator device.
Release checksum or signature verification is not yet part of this updater. A
compromise of the canonical release account could therefore publish malicious
code under a valid stable tag; explicit user invocation limits installation but
does not remove that supply-chain risk. See ADR 0004 for the decision record.

## Local Residual Risks

- The local relay is volatile, process-local, and not production hardened.
- Creator state stores live links and revocation capabilities in a mode-0600
  local file; Windows protection inherits the user's directory ACL.
- The update cache stores only a last-check timestamp and latest stable version
  in `~/.agentshare/update-check-v1.json`; malformed cache content is ignored and
  refreshed rather than trusted as executable data.
- Decrypted recipient context exists in process memory and may appear in OS swap
  or crash dumps. AgentShare does not claim secure memory erasure.
- Codex may enumerate skill metadata during startup, but AgentShare disables its
  shell, unified exec, patch, JavaScript, code-mode, search, app, and plugin
  tool surfaces before handing it untrusted context. Launchers fail closed on
  unreviewed Codex or Claude versions.
- Capability links can leak through clipboard managers, screenshots, browser
  extensions, screen recording, or compromised endpoints. The handoff page
  immediately removes query and fragment data from visible history, uses
  `no-referrer`, loads no third-party assets, and sends no analytics.
- Compromise of the trusted AgentShare handoff origin could replace the browser
  JavaScript and expose capability fragments. Separating the handoff origin from
  custom ciphertext relays removes relay-controlled page code from the new-link
  threat model; it does not eliminate compromise of the trusted handoff service
  itself.
- Secret scanning covers known credential formats in text plus ASCII, UTF-8,
  UTF-16LE, and UTF-16BE views of binary resources. It cannot inspect encrypted,
  compressed, or unknown encodings.
- Creator review is exact for normalized/redacted text. Binary resource bytes
  are not rendered byte-for-byte in the terminal; binary resources are
  inventoried by media type, byte length, and SHA-256, and a suspected secret
  found in the supported binary text views blocks sharing. Omit binary resources
  you cannot independently trust.
- Per-source capacity controls increase the cost of relay exhaustion but cannot
  eliminate distributed abuse across many source addresses.
- Hashing source addresses minimizes stored quota data; it does not anonymize
  low-entropy IP addresses or hide them from Cloudflare.
