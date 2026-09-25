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

> [!NOTE] This package is the **v0.3.15 candidate** for collaborative
> environments. Native Windows Codex acceptance and public deployment
> verification remain required before stable promotion. Do not infer readiness
> from the package version alone. Use the published stable GitHub release for
> ordinary installation and do not share high-risk data through the public beta.

## Create an Environment

In Codex, connect the pinned MCP package (see the
[project setup](../../README.md)) and call `setup_agentshare` at first use. The
native setup choice installs the pinned global CLI and local integration files
only when accepted. It can also save Codex `On Request` prompts as the default
for future sessions, but only if the user selects that option. Existing CLI
users can run `agentshare init` and start a new host session after the MCP
configuration changes.

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

In Codex, these choices and the final Publish/Cancel action are native forms
operated with arrow keys and Enter in the same session. A concise summary
appears before publication. YOLO mode auto-cancels native prompts; enable
interactive prompts through `/permissions` first. Direct CLI and Claude creator
flows require an interactive terminal. There is no public `--yes` approval
bypass.

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

Paste a complete AgentShare `/e/` link into Codex or Claude Code and ask to open
it. For a first-time recipient, the handoff page gives the agent the pinned
installation command and instructions to attach and query in the same session.
Node.js 22+ and a supported, signed-in agent CLI are required. No SDK or manual
MCP configuration is needed. Bootstrap installs receiver integrations for future
sessions; the current agent can use the page's commands immediately.

The explicit CLI path is:

```sh
agentshare bootstrap
```

Provide the complete capability link on stdin or through the command's
interactive input, not as a shell argument.

After an environment is attached:

```sh
agentshare ask --target codex --environment <attached-id> --question "What remains unresolved?"
agentshare ask --target claude --environment <attached-id> --question "What remains unresolved?"
```

AgentShare refreshes approved revisions and starts an isolated supported child
agent with only the local AgentShare evidence interface. Use the environment ID
returned by bootstrap so multiple attached links remain unambiguous. On Windows,
missing or stale Codex model metadata is automatically refreshed in a private
home before applying the normal tool restrictions.

If the environment includes proposal access, an explicit requested change can be
submitted as encrypted proposal ciphertext:

```sh
agentshare propose --target codex --environment <attached-id> --instruction "Update the parser tests"
agentshare propose --target claude --environment <attached-id> --instruction "Update the parser tests"
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
