# v0.3.15: optional Codex prompt default

This candidate adds a second choice to the native first-use setup form. After
choosing to install the pinned CLI and managed skills, the user can keep their
current Codex permission default or save `On Request` for future sessions.
AgentShare changes the user-level `approval_policy` only after the native form
returns that exact choice. Cancelled or incomplete setup performs no writes.

The config edit preserves unrelated settings, writes a private backup, and
refuses unsupported or duplicate root approval policies. It does not change the
active Codex session. A user already in YOLO/full-auto mode must select
`/permissions` → `On Request` in that session before the native form can appear.
Publication still has a separate Publish/Cancel confirmation.

Setup also installs matching Codex skill files under both `.agents/skills` and
Codex's own skills directory. A fresh-session check on a machine with a large
skills catalog found the creator skill only after adding the Codex-directory
copy. The managed copies have identical content and are removed together.

This file describes candidate behavior. Native UI setup, actual creator and
recipient flows, public deployment, and release promotion require separate
evidence. Real Claude Code acceptance remains unverified.
