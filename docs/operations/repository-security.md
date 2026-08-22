# Repository Security Runbook

This runbook covers controls that cannot be enforced by application source
alone. Repository administrators should verify these settings before merging a
security release.

AgentShare's repository is part of the trust chain for a free and open context
transport. Protecting release integrity matters especially because the project
deliberately avoids a central account/control plane and distributes executable
client code that handles capability links and plaintext locally.

The canonical project direction is [`../VISION.md`](../VISION.md). Changes that
would introduce mandatory accounts, paid access to the base protocol, central
plaintext indexing, or a proprietary-only protocol dependency require explicit
architectural review in addition to normal code review.

## Default branch protection

Protect `master` with a GitHub ruleset or branch-protection rule that:

- requires changes to arrive through pull requests;
- requires the `ci` workflow to pass before merge;
- requires the branch to be up to date before merge when practical;
- blocks force pushes and branch deletion;
- restricts bypass permissions to the smallest necessary administrator set;
- dismisses or revalidates stale approvals when the PR head changes if reviews
  are required;
- prefers signed commits and signed release tags where the repository workflow
  supports them.

A source-code CI file does not protect the branch by itself. Required-check
enforcement must be configured in GitHub settings.

## Secret scanning

For this public repository:

1. Open **Settings → Code security and analysis** and verify GitHub secret
   scanning and push protection are enabled where available.
2. Open **Security → Secret scanning** and resolve every real alert. Do not
   close an alert as a false positive without recording why the matched value is
   synthetic or revoked.
3. Treat a historical credential as compromised even if it was later deleted
   from the branch. Rotate/revoke it at the provider, then remove it from
   reachable history when appropriate.
4. Keep creator-side AgentShare scanning enabled; repository secret scanning and
   bundle scanning defend different boundaries.

Synthetic scanner tests should construct fake credentials programmatically
rather than commit real provider credentials.

Complete AgentShare capability links are secrets too. A public example link must
never contain a real read capability, revoke capability, or encryption key.

## Release immutability and verification

Before publishing a new release:

- enable GitHub immutable releases for the repository if the feature is
  available;
- publish only after the intended tag and assets are final;
- record each release asset's byte size and SHA-256 in the release-verification
  document;
- verify the published release and asset using GitHub's release verification UI
  or supported `gh release verify` / `gh release verify-asset` commands;
- perform an anonymous download and compare its digest with the recorded digest.

Enabling immutable releases later does not retroactively prove that an older
release was immutable when published. For `v0.1.10`, verify the existing release
independently and record the result rather than inferring it from this
repository.

## Open-source and protocol continuity

A release should not accidentally make the official hosted service a mandatory
proprietary dependency. Before merging protocol or deployment changes, verify
that:

- ACB and relay behavior required for interoperability remains documented;
- self-hosted/compatible relay use is not artificially blocked;
- current hosted URLs are defaults rather than secret protocol knowledge;
- no build step depends on private source required to understand or reproduce
  the client/relay trust boundary;
- no billing or account credential becomes required for the base share/open
  path.

This is a project-continuity control as well as a product principle.

## Package contents

`@agentshare/cli` uses a package allowlist. Release verification must confirm
the packed artifact contains only the intended distributable files: bundled CLI
output plus the required README/license/notice files. Source-session artifacts,
`.env` files, local state, coverage output, and agent transcripts must never
enter the package.

## Merge checklist

Before merging a security-hardening or protocol PR:

- [ ] required CI checks are green on the final PR head;
- [ ] `master` protection/ruleset is active and force pushes are blocked;
- [ ] unresolved secret-scanning alerts have been reviewed;
- [ ] push protection is enabled where available;
- [ ] release immutability is enabled for future releases;
- [ ] the current release's immutability/asset verification status is explicitly
      recorded;
- [ ] no operational account IDs, deployment UUIDs, credentials, complete
      capability URLs, decrypted handoffs, or private source were added to
      public docs;
- [ ] protocol/security changes still preserve the documented blind-relay and
      creator-review boundaries, or a new ADR explicitly records the change;
- [ ] current product docs do not claim unsupported agent compatibility;
- [ ] historical release evidence was not rewritten to manufacture present-day
      guarantees.
