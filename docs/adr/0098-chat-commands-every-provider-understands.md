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
- ~~Chat apps (Telegram and the rest) keep their own command set; `/clear`, `/goal` and
  `/plan` there would be a later change through the same gateway methods.~~ Done: see the
  amendment below.

## Amendment (2026-10-06): the same commands in every chat app

Chat apps had their own handful (`/new`, `/stop`, `/help`, and ADR 0091's settings
shortcuts), written as regular expressions in the channel service, so they drifted from
the web app's. Now there is one list.

1. **One registry, in the protocol.** `COMMANDS` (`packages/protocol/src/commands.ts`)
   holds every command's name, other names, section, words and values. The web app's
   `builtins` is derived from it (`apps/web/src/features/commands/slash.ts`); a command
   with `chat` works from chat apps, with `who` (`owner`: the channel owner in their
   private chat; `people`: anyone let in, on their own conversation), `groups` (it works
   in a group) and its chat-app words where they differ. `/stop`, `/start` and `/cancel`
   are chat-app only (`web: false`). `parseChatCommand`, `similarCommands`,
   `parseSwitch`, `parseEffortArg`, `parseGoalArg` and `expandCustom` are shared.
2. **Done through the same gateway methods.** `ChannelService.#chatCommand` answers them:
   `/clear` and `/undo` through `ConversationManager.clear` and `restoreContext`, `/goal`
   through `setGoal`, `/plan` through `configure` (back to `modeBeforePlan` when it ends),
   `/compact` through `compact`, `/retry` by sending the last message after the clear
   again. Before a conversation exists, a goal and plan mode wait for the message that
   starts it (`conversation.send.goal`, `options.permissionMode`), and `/new` drops them.
   `/model`, `/effort`, `/fast`, `/mode`, `/status` and `/settings` stay with ADR 0091's
   menu. Your own command is filled in and sent; a skill of yours or the provider's own
   command goes on as typed; a command only Conch has says so; a name nobody knows hears
   what it probably meant, with a button for it.
3. **Approving a plan from a chat app.** A channel conversation (not a group guest's) is
   one where someone can press Start, so an engine without its own question gets
   `exit_plan_mode` there too. The question arrives as the plan, then **Start** and
   **Keep planning**: buttons where the app has them, numbered replies (`1`, `yes`, `no`)
   where it hasn't (`TextChoices`).
4. **Values as buttons, the one in use ticked.** A command's own list has no Back, puts as
   many choices under one message as the app shows comfortably
   (`ChannelConnection.buttonLimit`: Telegram 8, Discord's five rows by default, one-digit
   replies elsewhere), and `/model` opens on the provider in use. A model, effort or speed
   picked for this chat is done at once (the pick was the confirmation); ADR 0091's
   confirmation stays for defaults across Conch, for going back to them, and for a mode
   that lets the assistant do more without asking (Auto, Edit freely, Full trust).
5. **One-tap answers that aren't settings** (Undo, "did you mean", Clear goal, Plan
   first) are `ChatActions`: single-use, bound to the channel, chat and person, ten
   minutes, bounded in memory, rechecked against who is still let in on every press. A
   plain "yes" in a text-only app presses only an answer marked as the yes, so it can't
   undo a clear nobody asked about.
6. **The app's own `/` menu**, from the same list (`nativeMenu`): Telegram's
   `setMyCommands` (and only `/new`, `/stop` and `/help` for groups), Discord's
   application commands (chosen ones arrive as interactions, shown back to the person
   alone, then handled as the words they stand for), Teams' command list (ten, most wanted
   first). Slack keeps every message starting with `/` for itself, so Conch's go after
   one registered `/conch` command (Socket Mode `slash_commands`), and every reply writes
   them that way (`slashIn`).

Who may run what follows ADR 0091 and ADR 0075: anything that changes how Conch works is
the owner's, typed in their private chat; forwards, quotes and files never run a command;
in a group only `/new`, `/stop` and `/help` work, each on the sender's own conversation.
