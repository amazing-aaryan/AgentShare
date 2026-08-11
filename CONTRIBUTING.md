# Contributing

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

Never commit real agent sessions, credentials, private source, capability URLs,
or decrypted bundles. Protocol or security-boundary changes require an ADR. By
participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
