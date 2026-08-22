# Historical Construction Plans

Files in this directory are implementation history, not authoritative current
product, architecture, or security guidance.

- [AgentShare v0 Blueprint](./agentshare-v0-blueprint.md) — historical 15-step
  construction plan retained for provenance. It predates the current
  split-origin handoff model, current release procedures, and the explicit
  project-wide open-context transport direction.

The current project mission is defined in [`docs/VISION.md`](../docs/VISION.md):
AgentShare is a free and open, account-free, capability-based transport for
handing AI context across people, machines, and agent vendors without requiring
the relay to receive the share plaintext or encryption key.

The historical blueprint should **not** be interpreted as a mandate to build a
team workspace, paid SaaS tier, organization permission system, permanent
transcript archive, or central plaintext knowledge base. Where it discusses
Codex/Claude specifically, those hosts should now be understood as the initial
adapters to an open Agent Context Bundle boundary rather than the permanent scope
of the project.

For current behavior use, in order:

1. `docs/VISION.md` and accepted ADRs for direction;
2. `SECURITY.md` for the trust boundary;
3. `docs/protocol/` for current protocol contracts;
4. `docs/operations/` for current deployment/release procedures.

When historical plans disagree with those documents, the current documentation
is authoritative. Historical files themselves are intentionally preserved rather
than rewritten to make old plans appear newer than they were.
