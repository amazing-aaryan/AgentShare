# Contributing

Use Node.js 22 or newer. Create focused changes, add tests for behavior, and run
all repository checks before opening a pull request:

```powershell
npm run format:check
npm run lint
npm run build
npm test
```

Never commit real agent sessions, credentials, private source, capability URLs,
or decrypted bundles. Protocol or security-boundary changes require an ADR.
