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

Security invariants:

- Encryption and decryption happen on clients.
- URL fragment keys never reach the relay.
- The relay stores ciphertext and digests, never plaintext or raw capabilities.
- Recipient plaintext, keys, and indexes remain memory-only.
- Host launchers fail closed when query-only isolation cannot be established.
- Untrusted terminal output is stripped of terminal and bidirectional control
  characters before display.
- Public relay admission uses a pseudonymous source identity digest, per-source
  active-share limits, and short provisional reservations.

## Local Residual Risks

- The local relay is volatile, process-local, and not production hardened.
- Creator state stores live links and revocation capabilities in a mode-0600
  local file; Windows protection inherits the user's directory ACL.
- Decrypted recipient context exists in process memory and may appear in OS swap
  or crash dumps. AgentShare does not claim secure memory erasure.
- Codex may enumerate skill metadata during startup, but AgentShare disables its
  shell, unified exec, patch, JavaScript, code-mode, search, app, and plugin
  tool surfaces before handing it untrusted context. Launchers fail closed on
  unreviewed Codex or Claude versions.
- Capability links can leak through clipboard managers or browser history. The
  share page immediately removes query and fragment data from visible history,
  uses `no-referrer`, loads no third-party assets, and sends no analytics.
- Secret scanning covers known credential formats in text plus ASCII, UTF-8,
  UTF-16LE, and UTF-16BE views of binary resources. It cannot inspect encrypted,
  compressed, or unknown encodings; creator review remains mandatory.
- Per-source capacity controls increase the cost of relay exhaustion but cannot
  eliminate distributed abuse across many source addresses.
- Hashing source addresses minimizes stored quota data; it does not anonymize
  low-entropy IP addresses or hide them from Cloudflare.
