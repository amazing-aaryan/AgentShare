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
    "version": "0.2.0",
    "packageUrl": "https://github.com/amazing-aaryan/AgentShare/releases/download/v0.2.0/agentshare-0.2.0.tgz"
  },
  "actions": {
    "accept": {
      "command": "agentshare bootstrap"
    }
  }
}
```

The bootstrap document contains no read/proposal capability or encryption key.

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

Subsequent `ask` and `propose` calls resolve the most recently attached active
environment when no ID is supplied.

## Same-link updates

Before shared-context work, AgentShare compares the locally attached revision
with relay metadata. If UserA has published a later committed revision,
AgentShare reconstructs the local capability URL from structured state,
downloads only missing encrypted blobs, decrypts/indexes the new revision, and
updates the attachment. UserB does not need a new link.
