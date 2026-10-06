# 0098 — Chat commands every provider understands: `/clear`, `/goal`, `/plan`, and a menu that completes

- Status: accepted
- Date: 2026-10-06
- Builds on: [ADR 0012](./0012-every-provider-at-once.md) (each provider keeps its
  own session, a chat moves between them), [ADR 0055](./0055-long-chats-on-every-model.md)
  (where the model's memory starts), [ADR 0060](./0060-the-chat-knows-conch.md) (plan
  mode's card)

## Context

Every coding agent has slash commands, and people expect the same ones everywhere:
`/clear`, `/model`, `/plan`, `/compact`, `/resume`, `/export`, `/undo`… Conch had a
handful, typed as raw strings, and `/clear` only opened a new chat. Three of the
expected commands can't be done in the browser alone, because they change what a
provider is told:

- **`/clear`** must make the model forget the chat, but each provider keeps its own
  session (Claude Code's, Codex's thread, the API engines' transcript), and a
  provider that joins later is handed what it missed (`handoff`).
- **`/goal`** must stay in the model's mind turn after turn, whichever provider answers.
- **`/plan`** (plan mode with an approval) only worked with Claude Code, whose
  `ExitPlanMode` asks to start. Every other engine just refused to change anything,
  and nothing ever asked.

## Decision

Conch does these itself, in the gateway, from the chat's own log, so they mean the
same with every provider.

1. **`/clear` is an event, not a deletion.** `context.cleared` marks where the model's
   memory starts; `contextStart(events)` (protocol `chat-context.ts`) reads it. A
   provider's session from before it is dropped when that provider next answers, and
   `handoff` hands over nothing at or before it, nor a summary from before it. Every
   message stays for the person. `context.restored` (Undo) takes back the newest clear
   while nothing was sent since (`undoableClear`); after that, a provider has already
   started afresh. What the chat is held to (ADR 0047) and what it has read (ADR 0028)
   are not memory, and a clear never touches them.
2. **`/goal` is an event too.** `goal {goal | null}`; `chatGoal(events)` is the one in
   force, put in every turn's system prompt (`conversations/goal.ts`), quoted as the
   person's own words. It survives `/clear`. A new chat's goal goes with its first
   message (`conversation.send.goal`).
3. **Plan mode asks to start on every engine.** An engine declares `planApproval:
'native'` when it asks by itself (Claude Code, the mock). Any other engine that can
   use Conch's tools gets `exit_plan_mode` in plan mode (`plans/mode.ts`) and a short
   plan-mode prompt; the tool puts the same `ExitPlanMode` question, so the web draws
   the same card. **Start**, from either, takes the chat out of plan mode in the
   gateway (`#leavePlan`), back to the mode it had before (`modeBeforePlan`, read from
   its `options` events), and the rest of the turn runs in it.
4. **The menu completes, in Nacre.** `CommandMenu` gains a second step: a command's
   values (`heading`, `onBack`), each `CommandItem` with an optional `title` to read
   and a `current` mark, and `autoActivate: false` where values only suggest (free
   text, like a goal). On touch it is a sheet above the keyboard with thumb-sized rows
   and a close button; it sizes itself from `--nc-visible-height`.
5. **Names.** Conch's commands win as before, but the newer ones (`yields`) give way
   to a command or skill of yours with the same name, so nothing a person made stops
   working. A provider's command of the same name as one of Conch's isn't listed;
   Conch's hands over to it where it does the job better (`/compact`, `/review`,
   `/init`).

## Consequences

- `/clear` is cheap, safe and undoable, and the transcript says where it happened.
- A provider can't remember past a clear even if it keeps its own session: the session
  is never resumed.
- The goal costs a few tokens on every turn; it is capped at 500 characters.
- Chat apps (Telegram and the rest) keep their own command set; `/clear`, `/goal` and
  `/plan` there would be a later change through the same gateway methods.
