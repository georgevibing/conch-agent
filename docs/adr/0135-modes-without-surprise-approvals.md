# 0135 — Modes without surprise approvals

- Status: accepted
- Date: 2026-10-16
- Amends: ADR 0031, 0047, 0100, 0117, 0119 and 0134

## Decision

The selected mode owns action approvals. Loading a skill must not silently downgrade Auto or Full trust for the rest of a chat. Ask first and Read only retain skill lists. Auto evaluates actual actions using the existing risk policy and second look. Full trust skips action approvals, including browser actions, destructive commands, app writes and external-content warnings. The same choice applies to tasks and channel turns within their existing permission ceilings.

Full trust also releases a pending action approval when the person changes the mode. Password access and leaving a plan remain personal decisions. Protected paths, disabled tools, guest restrictions, app seals and hard abuse limits remain enforced. No tool can select a higher mode or grant itself trust.

The skill hold banner appears only in modes that enforce it. Lists are kept so returning to Ask first restores them. Empty other-chat checks return information to the assistant without adding a transcript or Activity card. Older empty cards render nothing. Status narration is for findings, conflicts and explicit status requests.

## Threat model

An external page, skill, email or another agent can mislead the assistant. Auto still assesses the actual operation and keeps destructive-action, exfiltration and second-look checks. Full trust is an explicit acceptance of action risk, not a promise to prevent destructive work. It never grants access to Conch credentials, changes authentication, disables an Off switch or removes a sealed app boundary. The security checkup names the risk. No saved permission or skill record is widened or deleted.

Regression coverage exercises plain skills over multiple turns, native and bridged app approvals, mode changes while an action waits, destructive commands, disabled tools, guests, protected paths and quiet empty results.

## Sources

- [Claude Code permission system](https://code.claude.com/docs/en/permissions): mode-level control and separation of allowed actions from restrictions.
- [OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html): external content remains untrusted; enforce capability boundaries outside model instructions.

Reviewed 2026-10-16. Full trust intentionally accepts action risk; Auto remains the default.
