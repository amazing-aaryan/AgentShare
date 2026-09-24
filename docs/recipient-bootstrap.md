# AgentShare Recipient Bootstrap

AgentShare v2 is designed so the recipient's normal action is to paste one `/e/`
capability URL into Codex or Claude Code.

## Human route

`GET /e/<environment-id>` returns a no-store handoff page. URL fragment secrets
are not included in the HTTP request and the page never reflects them. The page
tells the recipient to paste the full link into their agent and documents the
Maximum privacy alternative.

## Machine-readable route

`GET /e/<environment-id>/bootstrap.json` returns the public bootstrap contract:

```json
{
  "protocol": "agentshare-bootstrap-v1",
  "product": "AgentShare",
  "environmentProtocol": "agentshare-environment-v2",
  "minimumNodeVersion": "22",
  "release": {
    "version": "0.3.14",
    "packageUrl": "https://github.com/amazing-aaryan/AgentShare/releases/download/v0.3.14/agentshare-0.3.14.tgz"
  },
  "actions": {
    "install": {
      "command": "npm install --global --ignore-scripts https://github.com/amazing-aaryan/AgentShare/releases/download/v0.3.14/agentshare-0.3.14.tgz"
    },
    "accept": {
      "command": "agentshare bootstrap"
    },
    "ask": {
      "codex": "agentshare ask --target codex --environment \"<environmentId from bootstrap>\" --question \"<user question>\"",
      "claude": "agentshare ask --target claude --environment \"<environmentId from bootstrap>\" --question \"<user question>\""
    },
    "propose": {
      "codex": "agentshare propose --target codex --environment \"<environmentId from bootstrap>\" --instruction \"<requested change>\"",
      "claude": "agentshare propose --target claude --environment \"<environmentId from bootstrap>\" --instruction \"<requested change>\""
    }
  }
}
```

The bootstrap document contains no read/proposal capability or encryption key.
It is public installation metadata and does not require a `relay` query. The
handoff page's setup anchor can therefore be followed exactly, even though a
relative URL does not inherit the original link's query string.

The handoff page includes the installation and follow-up commands directly so a
fresh agent session can use them before newly installed skills are discovered.
The user stays in that session; no SDK or manual MCP registration is needed.

## Installed receiver skills

`agentshare init` installs separate creator and receiver skills:

- Codex `$agentshare`: explicit-only creator flow.
- Codex `agentshare-receive`: implicit receiver flow for `/e/` links and
  attached environments.
- Claude `/share`: explicit-only creator flow.
- Claude `agentshare`: receiver flow for `/e/` links and attached environments.

The receiver skill delegates questions to `agentshare ask` and requested
modifications to `agentshare propose`. Those commands launch a separate
restricted child agent with the local AgentShare MCP server; receiver skills are
instructed not to inspect cache/state files directly.

## `agentshare bootstrap`

Bootstrap is idempotent:

1. repair/install host integration files;
2. receive exactly one capability URL from hidden interactive input or stdin;
3. validate environment metadata and ciphertext descriptors;
4. decrypt the current manifest locally;
5. download missing encrypted resource blobs;
6. build an encrypted local lexical index;
7. save structured attached-environment capability state;
8. return the environment ID, title, revision, file count, conversation-event
   count, proposal permission, and expiry.

Subsequent `ask` and `propose` calls pass the `environmentId` returned during
attachment. Without an explicit ID, commands work only when exactly one active
environment is attached; multiple attachments require a selection.

On Windows, if Codex's model metadata is absent or older than the installed
runtime, AgentShare asks the authenticated Codex app server for fresh metadata
in a private temporary home. It then applies the same model/tool restrictions.
This starts no model turn and does not change the user's canonical cache.

## Same-link updates

Before shared-context work, AgentShare compares the locally attached revision
with relay metadata. If UserA has published a later committed revision,
AgentShare reconstructs the local capability URL from structured state,
downloads only missing encrypted blobs, decrypts/indexes the new revision, and
updates the attachment. UserB does not need a new link.
