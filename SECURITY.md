# Security Policy

AgentShare is pre-release and does not yet provide a production security
guarantee. Report vulnerabilities privately to the repository maintainers.

Do not include secrets, capability URLs, decrypted bundles, or private source in
reports. Include affected version, reproducible steps using synthetic data, and
the expected impact.

Security invariants:

- Encryption and decryption happen on clients.
- URL fragment keys never reach the relay.
- The relay stores ciphertext and digests, never plaintext or raw capabilities.
- Recipient plaintext, keys, and indexes remain memory-only.
- Host launchers fail closed when query-only isolation cannot be established.

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
