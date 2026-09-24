# v0.3.6 candidate: YOLO-mode diagnosis

**Status: local candidate, not published or stable sign-off.**

Codex sessions launched in `YOLO mode` use `approval_policy=never`. Codex
therefore auto-declines MCP elicitation requests; AgentShare previously exposed
this only as `AgentShare cancelled`, which made a prepared draft look broken.

The managed creator skill now checks the session header before preparation and
directs the user to run `/approvals` → `On Request` in the same Codex session.
Declined or auto-cancelled native confirmation returns a diagnostic explaining
that switch and preserves the same draft/digest for retry. AgentShare still
requires real user confirmation and never treats chat text or model arguments as
publication approval.

This repair keeps the entire flow in Codex: no terminal fallback is needed when
the session is switched to `On Request`. Native Windows acceptance remains
required before any public release.
