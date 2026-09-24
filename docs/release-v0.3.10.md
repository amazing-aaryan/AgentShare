# v0.3.10 candidate: Codex permission-command compatibility

**Status: local candidate, not published or stable sign-off.**

The v0.3.9 native share flow was correct, but its recovery instruction named
`/approvals`, which Codex 0.155.1 does not recognize. The supported native TUI
command is `/permissions`; choose `On Request` there, then retry the same
AgentShare action. The managed skill now explicitly rejects the obsolete command
so the model cannot send the user into a dead-end.

Native scope/access/expiry and Publish/Cancel forms remain arrow-key + Enter
controls. No typed approval token or terminal fallback is introduced.
