- **Project:** AgentShare — the free, open protocol/tool for securely handing AI
  context to anyone through capability links
- **Core model:** creator selects/reviews context -> local encryption -> blind
  ciphertext relay -> capability link -> local recipient decryption -> isolated
  supported agent
- **Product principles:** free forever; open source forever; no AgentShare
  accounts/workspaces/organization boundary for the core flow; bearer capability
  links are the permission primitive; relay does not need share plaintext or the
  encryption key; sender review stays explicit
- **Current adapters:** Codex and Claude Code; the long-term interoperability
  boundary is Agent Context Bundle (ACB), not either vendor's session format
- **Primary users:** indie hackers, cofounders, open-source collaborators,
  consultants/clients, cross-company collaborators, and people moving context
  between their own machines or agents
- **Non-goals:** paid SaaS tiers, seat management, mandatory identity/SSO,
  permanent company transcript warehouse, team chat, employee monitoring, or a
  proprietary agent runtime
- **Stack:** TypeScript, Node 22+, Vitest, Cloudflare Workers/Durable Objects,
  GitHub Actions
- **Current release focus:** maintain and verify the v0.1.11 public beta while
  broadening the project toward vendor-neutral context transport without
  weakening the current security boundary
- **Current blocker:** Codex 0.149.0 failed the required Windows compatibility
  contract safely and remains unsupported; reviewed Codex 0.147.0 is used for
  the release gate
- **Key constraints:** exact release commit must pass six-job CI and zero-skip
  real-agent gate; deploy hardened relay and handoff before package publication;
  never alter published Durable Object migrations; new host support must fail
  closed unless isolation is proven
- **Canonical direction:** `docs/VISION.md` and ADR 0005; current security and
  protocol behavior remains authoritative in `SECURITY.md` and `docs/protocol/`
- **Last updated:** 2026-08-21
