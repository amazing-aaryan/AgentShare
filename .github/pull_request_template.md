## Summary

Describe the behavior changed and why.

## Vision alignment

AgentShare's base project is a free/open, account-free, capability-based context
transport. See `docs/VISION.md` and ADR 0005.

- [ ] Preserves the core share/open flow without requiring AgentShare accounts,
      organization membership, or paid access, or explains an approved ADR that
      changes this
- [ ] Does not require the relay to receive conversation plaintext or the
      encryption key, or documents the security-boundary change in an ADR
- [ ] Preserves explicit creator selection/review and does not silently broaden
      workspace access
- [ ] Distinguishes current host support from the long-term agent-agnostic
      direction

## Verification

- [ ] Added or updated focused tests
- [ ] Ran `npm run format:check`
- [ ] Ran `npm run lint`
- [ ] Ran `npm run build`
- [ ] Ran `npm run test:coverage`
- [ ] Ran `npm run test:package`
- [ ] Ran `npm run test:edge-runtime`
- [ ] Ran `npm audit --audit-level=high`

## Security

- [ ] No secrets, complete capability URLs, private source, or decrypted bundles
      included
- [ ] Security/protocol-boundary changes documented in an ADR, or not applicable
- [ ] Historical release evidence remains historically accurate
