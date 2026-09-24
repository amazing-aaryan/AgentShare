# v0.3.9 candidate: native share-option selection

**Status: local candidate, not published or stable sign-off.**

This candidate makes the complete Codex creator path native and in-session:

1. `select_share_options` opens native titled select controls for scope,
   recipient access, and expiry.
2. The user moves through each choice with arrow keys and presses Enter. No
   typed scope, access, expiry, or `PUBLISH` token is required.
3. The MCP server stores the accepted native values by session and binds them
   server-side when `prepare_share` runs. Model-supplied option values cannot
   replace the native selection.
4. `commit_share` uses the same native select pattern for Publish/Apply/Revoke
   or Cancel; users never type `PUBLISH`, `APPLY`, or `REVOKE`.

If the recorded project root is unavailable, the skill stops instead of asking
for a typed replacement path or guessing another folder.

YOLO/full-auto still auto-declines native elicitation. In that mode, switch
`/approvals` to `On Request` in the same Codex session, then restart or reload
the MCP server so it loads the installed candidate. No terminal fallback is used
when the user asks to stay in Codex.

Synthetic protocol tests validate the schema and server binding. They are not
substitutes for fresh native Codex acceptance on the exact installed version.
