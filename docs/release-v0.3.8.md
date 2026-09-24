# v0.3.8 candidate: native arrow-key confirmation

**Status: local candidate, not published or stable sign-off.**

AgentShare confirmation is now a native MCP select form. The user reviews the
exact action, moves through `Publish exact reviewed draft` (or the corresponding
apply/revoke option) and `Cancel` with arrow keys, then presses Enter. No
confirmation word is typed, no terminal is opened, and the same Codex session
handles preparation, review, and publication.

YOLO/full-auto remains incompatible with user confirmation. The user must switch
`/approvals` to `On Request` before preparation or retry the same draft after an
auto-cancel. Real native acceptance remains required before release.
