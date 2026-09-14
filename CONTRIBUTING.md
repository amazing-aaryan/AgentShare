# Contributing

AgentShare is being built as a **free, open, capability-based transport for AI
context**. Before changing product behavior, read
[`docs/VISION.md`](docs/VISION.md) and
[ADR 0005](docs/adr/0005-open-context-transport.md).

Contributions are especially welcome when they make the core handoff more
portable, understandable, auditable, or useful across agent vendors without
requiring a central account/workspace model.

## Design Filter

Prefer changes that preserve these properties:

- no AgentShare account or organization membership required for the core
  share/open flow;
- complete capability links remain the portable authorization primitive;
- the relay does not need conversation plaintext or the encryption key;
- creators explicitly select and review what leaves their device;
- host-specific sessions translate through an open Agent Context Bundle rather
  than becoming proprietary server-side state;
- self-hosting and compatible third-party implementations remain possible;
- the project remains usable without a paid tier.

Features that require central plaintext indexing, mandatory identity, seat
management, billing, permanent company transcript storage, or silent expansion
of workspace access conflict with the base-project direction and should not be
introduced without an explicit new architectural decision.

## Development

Use Node.js 22 or newer. Create focused changes, add tests for behavior, and run
all repository checks before opening a pull request:

```powershell
npm ci
npm run format:check
npm run lint
npm run build
npm run test:coverage
npm run test:package
npm run test:edge-runtime
npm audit --audit-level=high
```

Recipient-adapter changes additionally need real host capability/isolation
evidence before an exact host version becomes supported. Protocol or
security-boundary changes require an ADR.

## Safety of Test Material

Never commit real agent sessions, credentials, private source, complete
capability URLs, decryption keys, or decrypted bundles. Use synthetic fixtures.
Do not weaken creator review or secret scanning merely to make a new adapter
simpler.

## Documentation

Documentation must distinguish **current support** from **project direction**.
For example, Codex and Claude Code are the current first-class integrations;
calling AgentShare agent-agnostic describes the protocol direction, not a claim
that every agent works today.

Historical release verification and dated implementation plans should remain
historically accurate. Point readers to the current vision/security/protocol
docs instead of rewriting old evidence to match new positioning.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
