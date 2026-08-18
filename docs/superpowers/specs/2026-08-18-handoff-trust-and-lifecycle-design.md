# AgentShare handoff trust and lifecycle hardening

Date: 2026-08-18
Status: Approved

## Goal

Close the four review findings without weakening AgentShare's encrypted handoff model: preserve revocation credentials for every live `--new` share, prevent noninteractive approval bypass in the shipped CLI, require creator confirmation before reusing a live link, and prevent an arbitrary ciphertext relay from serving JavaScript that can read the decryption-key fragment.

## Design

### Multiple live shares

Local state is keyed by share identity, not by logical fingerprint. Saving a new share replaces only an existing record with the same relay origin and share ID. Multiple unexpired records with the same fingerprint and relay may coexist. Reuse lookup returns the newest unexpired matching record. Revocation still resolves by exact capability URL, so every live link retains its own revoke capability.

### Approval boundary

The public `agentshare` executable does not accept `--yes`. Interactive creator flows always show the normalized payload before a new upload and ask for approval. Tests may call the library API with an internal `assumeApproved` option; that option is not parsed from command-line arguments, documented in public usage, or installed into host integrations.

When an identical live share exists, AgentShare prints its fingerprint and authoritative expiry and asks `Reuse this existing live share?`. Declining reuse continues through normal review and creates a new share rather than silently returning the old bearer link.

### Independent handoff origin

The ciphertext relay is not allowed to serve the recipient bootstrap page in the new flow. The repository gains a separate Cloudflare Worker app, `apps/handoff`, with no Durable Object, rate-limit, ciphertext, or capability bindings. It serves only the static recipient page.

New capability links use the trusted handoff origin as their URL origin and carry the selected relay origin in a non-secret `relay=` query parameter. The read capability and AES key remain in the URL fragment. The recipient page validates `relay` as HTTPS (or loopback for development), strips query/fragment material from visible history, uses `relay` only for metadata checks, and never sends the fragment key anywhere.

The CLI parser returns both `handoffOrigin` and `relayOrigin`. Recipient download/decrypt uses `relayOrigin`; it never infers the relay from the page origin for new links. Legacy v0.1.9 links without `relay=` remain readable by treating the link origin as the relay origin.

The edge relay no longer serves `/s/:shareId`; it redirects legacy browser opens to the trusted handoff origin while preserving the capability fragment client-side only through a small fragment-free redirect URL is impossible. Therefore, for compatibility and safety, legacy `/s/:shareId` responses remain the existing page only for already-issued links, but new links are never constructed on a relay origin. Documentation explicitly scopes the stronger malicious-relay guarantee to new-format links; legacy links retain the v0.1.9 honest-page trust assumption until they expire.

### Binary review wording

Documentation and terminal copy stop claiming that binary resources are displayed byte-for-byte. The creator review guarantee becomes: all text plaintext is displayed exactly; binary resources are inventoried by media type, byte length, and SHA-256 and are rejected if the scanner finds a suspected secret in supported text views.

## Compatibility and rollout

The next release is `0.1.10`. Package-first ordering remains mandatory: publish the immutable CLI asset, deploy `apps/handoff`, then deploy/update the relay and README pins. The handoff page for source builds targets v0.1.10, so it must not be deployed publicly before the package exists.

The public relay protocol endpoints and ciphertext format do not change. Existing v0.1.9 capability links continue to open in v0.1.10.

## Tests

Add regression coverage for:

- two same-fingerprint forced-new shares persisting simultaneously and each remaining independently revocable;
- newest-live-share reuse selection;
- no public `--yes` command-line bypass;
- explicit reuse confirmation and decline-to-new behavior;
- parsing new links with separate handoff and relay origins plus legacy compatibility;
- handoff page metadata requests going to the relay query parameter while the key remains fragment-only;
- edge relay no longer being used to construct new links;
- existing crypto, package, edge-runtime, and real-agent isolation suites remaining unchanged and green.
