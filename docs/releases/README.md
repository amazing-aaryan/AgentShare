# Release Verification Records

Files in this directory are evidence for specific historical AgentShare releases.
They intentionally preserve the product behavior, host versions, deployment
state, hashes, and verification results that were true when each release was
reviewed.

They are **not** the canonical source of the current project vision.

For current direction, read:

1. [`../VISION.md`](../VISION.md) — AgentShare as a free/open, account-free,
   capability-based context transport;
2. [`../../SECURITY.md`](../../SECURITY.md) — current trust boundary and residual
   risks;
3. [`../protocol/`](../protocol/) — current ACB and blind-relay contracts;
4. [`../operations/`](../operations/) — current operational procedures;
5. accepted ADRs, especially
   [`../adr/0005-open-context-transport.md`](../adr/0005-open-context-transport.md).

Older release records may describe only Codex/Claude behavior because those were
the implemented adapters at the time. The current agent-agnostic direction does
not retroactively make other agents supported by those releases.

Likewise, historical records should not be rewritten to claim that old releases
implemented future protocol features or current deployment assumptions. When a
historical record conflicts with current documentation, treat the record as
evidence about that release and the current docs as authoritative for present
behavior/direction.
