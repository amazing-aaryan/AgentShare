# v0.3.5 candidate: explicit native owner confirmation

**Status: local candidate, not published or stable sign-off.** The immutable
v0.3.4 package and its acceptance evidence remain unchanged.

The creator MCP native form now requires the owner to type `PUBLISH` for a
share, `APPLY` for a proposal, or `REVOKE` for revocation. Tool-call approval
alone and an MCP `accept` response with missing or incorrect form content are
not consent. Incomplete, unsupported, and timed-out native forms return distinct
errors; share errors include the interactive terminal review command for the
same prepared draft. No response path silently promotes missing form content to
approval.

The initiating report showed a prepared draft after an apparently approved
native prompt. The installed v0.3.3 form used a required boolean with
`default: false`; the report did not include the actual native form response, so
the precise response cannot be inferred. This candidate removes that ambiguous
default and preserves fail-closed behavior.

Synthetic MCP protocol tests are regression coverage, **not native UI
acceptance**. Before publication or stable promotion, repeat the exact-version
real-host acceptance contract in [`release-v0.3.4.md`](./release-v0.3.4.md),
including explicit human consent, independent recipient recovery, cache
integrity, cleanup, and 18/18 checks.
