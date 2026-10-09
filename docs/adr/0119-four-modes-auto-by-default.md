# 0119 — Four modes, Auto by default

- Status: accepted
- Date: 2026-10-09
- Builds on: [ADR 0100](./0100-permission-modes-every-provider.md) (the ladder, one definition
  of the modes), [ADR 0117](./0117-auto-asks-about-what-matters.md) and
  [ADR 0118](./0118-auto-judges-every-app-step.md) (Auto asks only about what matters),
  [ADR 0033](./0033-hand-it-off.md) (a task has its chat's powers)
- Amends: ADR 0100's five modes (Edit freely is gone, Plan only is called Read only) and its
  default (new chats start in Auto, not Ask first)

## Context

ADR 0100 made five modes mean the same with every provider: Plan only, Ask first, Edit freely,
Auto and Full trust. Since ADR 0117 and ADR 0118, Auto goes ahead with edits in the work
folder, commands, installs and app steps, and asks only before something risky. That left
Edit freely with nothing of its own: everything it let through, Auto lets through, and the
commands it still asked about were routine work Auto doesn't ask about. Two modes a step
apart that differ only in how often they ask about `npm test` is a choice nobody can make
well, and a fifth line in every picker.

New chats started in Ask first, the mode that asks most. Auto is the mode people live in
(AGENTS.md, security rule 11), so most people's first act was to change it, and those who
didn't met a question for every step.

The words had grown long too: Auto's line ran to two sentences, and the line under the
message box ("{name} can make mistakes, and …") repeated it.

## Decision

Four modes, from the least the assistant does alone to the most (`MODE_POWER`), with the
words in `packages/protocol/src/modes.ts` (`MODE_WORDS`), the one definition every picker,
Settings → Models, the chat apps' `/mode` and the documentation read:

| Id                  | Name       | Line                                           |
| ------------------- | ---------- | ---------------------------------------------- |
| `plan`              | Read only  | Looks and plans. Changes nothing.              |
| `default`           | Ask first  | Asks before each change.                       |
| `auto`              | Auto       | Gets on with it. Asks only before risky steps. |
| `bypassPermissions` | Full trust | Never asks. Runs anything.                     |

- **Edit freely (`acceptEdits`) is gone.** No provider offers it (`ALL_MODES` has four), and
  no engine maps to it: Claude Code runs `plan`, `default` (for Ask first and Auto, which
  Conch answers, ADR 0118) and `bypassPermissions`; Codex CLI and every provider through
  Conch's tools lose their "changes go ahead, commands ask" branch.
- **Plan only is called Read only.** Only the words change: the id stays `plan`, so `/plan`,
  Claude Code's own plan mode and every saved chat keep working. `/plan`, the ⌘K item and the
  chat apps' replies say Read only.
- **New chats start in Auto.** `Preferences.permissionMode` defaults to `auto`
  (`DEFAULT_MODE`), and so do Settings → Models and an agent's own mode before either is
  chosen. A routine you make in the editor starts in **Auto** too (`RoutineTrust` `auto`,
  which replaces "Allow file changes"). One source of truth for the default: the global
  preference; a chat's own choice overrides it; an agent's own mode (never Full trust)
  applies to the chats it starts.
- **Full trust's warning stays where it's chosen.** Its line is short; the confirmation in the
  picker and in Settings, the checkup and the restore preview still say what could happen.

### What was saved before

Nothing breaks and nothing needs rewriting. `PermissionMode` reads `acceptEdits` as `auto`
wherever a mode is read through Zod: a chat's options and its log, the global default, an
agent's defaults (`AgentDefaults`), a task, a channel's options, a routine's options, what a
provider says it honours, and a message from a page that hasn't reloaded. `RoutineTrust`
reads `edits` as `auto`. `/mode edit freely` and `/mode plan only` in a chat app still find
Auto and Read only. The restore preview counts a backup's `acceptEdits` as the Auto it will
become (`chats-go-ahead`).

### What deliberately doesn't move to Auto

- A **routine an assistant drafts** still starts at **Ask me first**: only a person grants a
  routine trust (AGENTS.md, security rule 7). Routines saved without a choice, and routines
  brought from another app, keep **Ask me first** too.
- **Leaving Read only** when the default itself is Read only goes to Ask first, as before:
  someone who chose to be careful isn't moved two steps up by approving a plan. Otherwise
  Start returns to the mode the chat had.
- A **task's ceiling** is its chat's mode (ADR 0033); where a task has none, the ceiling
  stays Ask first.
- The checkup's fix for Full trust still sets **Ask first**, the step a person asked for.
- The first job in onboarding runs in Ask first, as it did: it shows each step it takes.
- **Existing settings stay as they are.** Someone whose saved default is Ask first keeps it;
  only new installs, and settings files without a mode, start in Auto.

## Threat model

Auto by default means a new person's first chat goes ahead with routine work. What protects
them is ADR 0117 and ADR 0118's: the risk policy, the guard after reading, the second look,
the behaviour watch and the checks no mode lifts all hold in Auto, on every provider. No new
way in: nothing an agent, a page or a chat app sends can choose a mode above the chat's
(`noMoreThan`, a raise asks to save in a chat app, Full trust is confirmed by a person), and
reading `acceptEdits` as Auto only ever lands on the mode a person had chosen the step below.

## Consequences

- One fewer choice in every picker, and each line fits on one row.
- People who want every step asked choose Ask first once, in Settings → Models.
- Tests and stories that named five modes, Edit freely or Plan only now name four.
- Stored data: no migration; old values read as their new ones.
