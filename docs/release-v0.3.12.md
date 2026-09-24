# v0.3.12 candidate: simple creator UX regression fix

**Status: local candidate, not published or stable sign-off.**

This patch keeps the v0.3.11 creator flow and corrects the native form contract
so Codex receives the required `files`, `access`, and `duration` fields.

Standard flow remains:

1. Resolve the current session.
2. Use one native arrow-key form for **Files to share**, **Access**, and
   **Duration**.
3. AgentShare prepares and scans locally, shows one concise summary, then opens
   one native **Publish / Cancel** choice.
4. Return the capability link.

No typed values or typed publish command are required. In Codex 0.155.1, use
`/permissions` → `On Request` when YOLO mode would otherwise auto-cancel native
choices; `/approvals` is not a supported command.
