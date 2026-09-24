# v0.3.11 candidate: simple creator UX

**Status: local candidate, not published or stable sign-off.**

The standard Codex creator path is now intentionally short:

1. Resolve the current session.
2. One native form chooses **Files to share**, **Access**, and **Duration**.
3. AgentShare prepares and scans locally, shows one concise summary, then opens
   one native **Publish / Cancel** choice.
4. The capability link is returned.

Users navigate every choice with arrow keys and Enter. No typed scope, path,
duration, access token, review command, or publish word is required. Lower-level
review/status tools remain available for advanced recovery and inspection.

If Codex is in YOLO mode, use `/permissions` → `On Request` before invoking the
skill. Codex 0.155.1 does not recognize `/approvals`.
