# AgentShare CLI

**Free, open, review-before-send AI context handoff by capability link.**

AgentShare lets you select useful context from a supported agent, review what
will cross the boundary, encrypt it locally, and send one link to another person
or machine. The recipient does not need an AgentShare account, shared workspace,
or company membership.

The official relay transports ciphertext and does not receive conversation or
workspace plaintext or the decryption key. The complete link is the bearer
access capability, so treat it as a secret.

Current first-class host integrations are Codex and Claude Code. The broader
project direction is agent-agnostic through the open Agent Context Bundle rather
than through a proprietary server-side session store.

Requires Node.js 22 or newer.

> [!NOTE] The repository contains the v0.2 collaborative-environment
> implementation. Until v0.3.0 passes the documented live release gate and is
> promoted to a stable GitHub release, use the current published stable package
> for production installation and treat v0.2 commands as release-candidate
> behavior.

## Create an Environment

After installing the CLI and running `agentshare init`, start a new Codex or
Claude Code session so the host discovers the AgentShare integration.

Use `$agentshare` in Codex or `/share` in Claude Code. The direct CLI
equivalents are:

```sh
agentshare share --current --source codex
agentshare share --current --source claude
```

For a new v2 environment, AgentShare interactively asks for:

- scope: conversation + project, conversation only, or project only;
- access: read + propose changes or read only;
- expiry: 1 hour, 24 hours, or 72 hours.

It then shows the included-file summary, exclusions, redactions, access mode,
and expiry before publication. Creator selection and final review require an
interactive terminal and fail closed when one is not available. There is no
public `--yes` approval bypass.

The output is one split-origin `/e/` capability link. Send the complete link
only to intended recipients.

### Creator controls

```sh
# Force a separate environment instead of reusing/updating the workspace link.
agentshare share --current --source codex --new

# Override a new environment's reviewed expiry, up to 72 hours.
agentshare share --current --source codex --new --ttl 3600

# Use compatible self-hosted transport and handoff origins.
agentshare share --current --source codex \
  --relay https://relay.example \
  --handoff https://handoff.example
```

Equivalent self-hosting environment variables are `AGENTSHARE_RELAY` and
`AGENTSHARE_HANDOFF`. `--ttl` must be an integer from `1` through `259200`
seconds.

Rerunning `agentshare share --current` in a workspace with an owned environment
shows actions for updating that environment, reviewing proposals, copying the
existing link, or creating a separate share. An approved revision keeps the same
recipient capability URL.

## Receive an Environment

`agentshare init` installs automatic receiver integrations for supported Codex
and Claude Code hosts. A recipient can paste a complete AgentShare `/e/` link
into a supported host; the integration treats it as a bearer secret and attaches
it through AgentShare rather than copying decrypted files into the current
project.

The explicit CLI path is:

```sh
agentshare bootstrap
```

Provide the complete capability link on stdin or through the command's
interactive input, not as a shell argument.

After an environment is attached:

```sh
agentshare ask --target codex --question "What remains unresolved?"
agentshare ask --target claude --question "What remains unresolved?"
```

AgentShare refreshes approved revisions and starts an isolated supported child
agent with only the local AgentShare evidence interface.

If the environment includes proposal access, an explicit requested change can be
submitted as encrypted proposal ciphertext:

```sh
agentshare propose --target codex --instruction "Update the parser tests"
agentshare propose --target claude --instruction "Update the parser tests"
```

A proposal never writes the creator's workspace directly.

## Review Proposals and Revoke

The creator reviews encrypted proposals through the creator-only inbox:

```sh
agentshare inbox --source codex
agentshare inbox --source claude
```

Approval applies deterministic file operations against the reviewed base
revision and publishes a new revision through the normal creator boundary.

Revoke a v2 environment with its creator-owned ID:

```sh
agentshare revoke-environment --environment <environment-id>
```

Revocation invalidates the environment capability for all recipients.

## V1 Compatibility

The original one-shot `/s/` handoff remains available for compatibility:

```sh
agentshare share-v1 --current --source codex
agentshare share-v1 ./context.md --source generic
agentshare open --target codex
agentshare revoke
```

`agentshare share --legacy ...` also selects the v1 path. V1 and v2 capability
formats are intentionally distinct; supporting v2 does not reinterpret existing
v1 ciphertext or links.

## Updates

Check the canonical AgentShare GitHub release and install a newer stable release
with:

```sh
agentshare update --check
agentshare update
```

Successful creator commands perform a best-effort release check at most once per
24 hours and write any update notice to stderr. They never install an update
silently. Set `AGENTSHARE_NO_UPDATE_CHECK=1` to disable passive checks; explicit
update commands still work.

The updater accepts only exact stable `vMAJOR.MINOR.PATCH` releases from
`amazing-aaryan/AgentShare`. Drafts and prereleases are ignored. After an
update, AgentShare verifies the new CLI version and runs `agentshare repair` so
managed Codex and Claude skills are refreshed without overwriting unmanaged
conflicts.

## Project Principles

AgentShare is intended to remain:

- free to use rather than freemium;
- open source and self-hostable;
- account-free for the core handoff flow;
- capability-based across organizational boundaries;
- blind at the relay content boundary;
- explicit about creator review;
- portable across more agent vendors over time.

See the [full guide](../../README.md), [project vision](../../docs/VISION.md),
and [environment protocol](../../docs/protocol/environment-v2.md).

Apache-2.0.
