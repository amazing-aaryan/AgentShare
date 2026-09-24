# v0.3.7 candidate: stay inside Codex

**Status: local candidate, not published or stable sign-off.**

The creator skill now keeps a requested share inside the current Codex session.
After a YOLO-mode cancellation, it tells the user to switch `/approvals` to
`On Request` and retry the same draft/digest. It does not launch a terminal, use
computer control to search for a hidden form, or prepare a second draft. The
terminal workflow remains available only when the user explicitly asks to leave
Codex.

This is layered on v0.3.6's diagnosis: YOLO/full-auto sets approval policy to
`never`, so Codex auto-declines MCP elicitation. Real user confirmation remains
required; no chat message or model argument can publish a share.
