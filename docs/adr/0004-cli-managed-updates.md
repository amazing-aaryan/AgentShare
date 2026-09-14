# ADR 0004: CLI-managed release updates

- Status: Accepted
- Date: 2026-08-20

## Decision

AgentShare creator installations may check the canonical GitHub Releases API for
a newer stable AgentShare release. Normal successful creator commands perform at
most one passive check per 24 hours. `AGENTSHARE_NO_UPDATE_CHECK=1` disables
passive checks. `agentshare update --check` always performs an explicit fresh
check, and `agentshare update` is the only command that installs an update.

Release discovery is fixed to `amazing-aaryan/AgentShare`. Remote metadata may
select only an exact stable tag of the form `vMAJOR.MINOR.PATCH`; draft,
prerelease, malformed, and downgrade candidates are rejected. AgentShare derives
the immutable tarball URL locally from the validated version and never executes
a release-provided download URL or release-body command.

An explicit update invokes npm without a shell to install the derived immutable
GitHub release tarball globally. After npm succeeds, the existing process
invokes the same CLI entrypoint with the current Node executable to verify that
the installed version exactly matches the selected release, then invokes the
newly installed CLI's `repair` command. This ensures refreshed Codex and Claude
skill files come from the newly installed package while preserving the
integrations package's refusal to overwrite unmanaged skills.

Passive checks are best-effort and never make sharing, revocation,
initialization, or repair fail. Update notices are written to stderr so command
stdout contracts, including the share capability URL, remain unchanged. Explicit
checks and updates surface discovery or installation failures normally.

## Security and privacy

The passive request contains no conversation content, capability URL, encryption
key, relay state, project path, AgentShare account identity, or share metadata.
It is an HTTPS GET to GitHub for the public repository's latest release and
includes the installed AgentShare version in the User-Agent. The local update
cache contains only the check timestamp and latest stable version and is stored
separately from `state-v1.json`.

This fits the account-free open-transport direction in ADR 0005: release checks
must not become a hidden login, analytics, licensing, paid-entitlement, or
workspace-registration channel.

This design intentionally does not silently install code. HTTPS and the GitHub
repository/release account remain part of the update trust chain. Release
checksum/signature verification can strengthen that chain later without changing
the CLI command model.

## Open-source continuity

The updater is a convenience path to the canonical open-source release, not a
control point that should make the official service mandatory. Manual immutable
package installation must remain available, and compatible/self-hosted relay
users must be able to update the client without registering with an AgentShare
service.

Future release distribution improvements should preserve the ability to audit
and obtain the exact client code that handles local plaintext and capabilities.

## Consequences

Release artifacts must keep the deterministic identity `agentshare-VERSION.tgz`
under tag `vVERSION`, and package tests verify the packed CLI reports the same
version as `packages/cli/package.json`. Release procedures must continue
publishing immutable GitHub release assets before advertising that version as
current.

Users in offline or tightly controlled environments can disable all passive
release traffic while retaining explicit update commands. A failed post-install
integration repair is reported as a partial update: the CLI may already be new,
but unmanaged integration files remain untouched and require user resolution.

See [`../VISION.md`](../VISION.md) and
[ADR 0005](0005-open-context-transport.md).
