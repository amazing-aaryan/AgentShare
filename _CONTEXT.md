- **Project:** AgentShare encrypted Codex/Claude context handoff CLI and Workers
- **Stack:** TypeScript, Node 22+, Vitest, Cloudflare Workers/Durable Objects,
  GitHub Actions
- **Current focus:** Prepare, verify, publish, and smoke-test v0.1.11 public
  beta
- **Blockers:** Codex 0.149.0 failed Windows compatibility safely and remains
  unsupported; release gate must use reviewed 0.147.0
- **Key constraints:** Exact commit must pass six-job CI and zero-skip
  real-agent gate; deploy handoff pin before package; never alter Durable Object
  migrations
- **Last updated:** 2026-08-21
