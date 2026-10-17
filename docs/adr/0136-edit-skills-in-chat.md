# 0136 — Review skill updates in chat

- Status: accepted
- Date: 2026-10-17

## Problem

The Skills page could edit saved instructions, but the assistant only had
`use_skill`. Asking it to update a skill led to attempts to write private files,
which the provider's sandbox correctly refused. Approving a shell command did
not provide a supported way to save the change.

## Decision

`inspect_skill` reads instructions as data without activating the skill. It can
list IDs to distinguish skills with the same name, including disabled skills.
`edit_skill` proposes complete replacement instructions with a short summary.
The tool returns a typed review card; it never saves a skill. The card shows the
current and proposed text. **Update skill** uses the existing authenticated Skills
update endpoint. This human action is required in Auto and Full trust alike.
No changes are made to protected paths, publisher trust or shell permissions.

A proposal contains the folder fingerprint read before drafting. The tool checks
it again before offering the card, and the store checks it inside its write mutex
before applying the change. Stale cards cannot overwrite newer edits. Permissions,
mode, title, description and supporting files are preserved. The ordinary skill
scanner still decides whether changed instructions may be used.

The proposal is kept in the existing tool-result event, so chat replay and backups
need no new store. The card reads the current skill to distinguish an applied
proposal from a stale one. Unattended work receives the inspection tool only.
Skills owned by another app remain read-only; Skills offers an editable copy.

## Security and limits

An injected page or skill may try to propose persistent instructions. Drafting
does not grant write authority: the person sees the actual replacement text, as
plain text, and must press the save button. The scanner's findings appear before
saving. The agent cannot turn a skill on or widen its declared permissions through
these tools. The authenticated API, origin checks and private-file protections
remain in place. No API key or approval credential is returned to the model.

Concurrent writes through Conch serialize; a separate program writing directly
to the folder is outside this mutex and may still race a save. Signed skills are
not editable through this flow. Changes to supporting files still use the Skills
owner's workflow.

Followed the [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html),
read 2026-10-17: separate untrusted content from instructions, constrain tool
authority, and require human review for persistent changes. Tests cover no-write
proposals, stale and concurrent saves, disabled skills, path-like names, extra
permission fields, and rendering instructions as text.
