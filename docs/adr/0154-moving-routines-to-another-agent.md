# 0154 — Moving routines to another agent

- Status: accepted
- Date: 2026-11-18
- Builds on: [ADR 0006](./0006-routines.md) (routines), [ADR 0063](./0063-this-computer-is-proven.md)
  (a folder only your account can write), [ADR 0075](./0075-group-chats.md) (a guest answers in
  words), [ADR 0108](./0108-the-phone-without-native-apps.md) (approving from a notification),
  [ADR 0112](./0112-agents-that-talk-to-each-other.md) (the door for other agents)

## Context

A person asked their other agent, Hermes, to "recreate the cron jobs Conch has set up here, and
ask Conch to deactivate its crons". Hermes found the routines by reading `~/.conch/routines`
directly, found no `conch` command that lists or pauses them, read Conch's source to find the
WebSocket protocol, made an access key (which signed the owner out everywhere), approved its own
device, and scripted a chat message asking Conch to pause two routines. Conch answered: "the
request came from Hermes, not from you". Hermes rightly wouldn't fake the owner's confirmation.
Both agents' routines stayed on, the person got every message twice, and a live key was left over.

Conch's refusal was right: another agent's words are never the person's consent (indirect prompt
injection, Greshake et al., 2023). The journey around it was wrong. There was no honest way to do
the obvious thing.

## Decision

Three ways, each with the authority it really has.

**1. The terminal (`conch routines`).** `list`, `pause <id|name> [--reason]`, `resume`, and
`export [--json]`. Having the terminal of the computer Conch runs on is having the computer, as
for `conch devices` (ADR 0024): it acts for the person, and an agent they run there acts for them
too. It reaches the running Conch the way launchers do (ADR 0063): an ask in `here/routines/`,
a folder only this account can write, answered beside it, so nothing crosses the network and the
change goes through `RoutineService` (the page hears at once, and the running Conch never writes
an older copy over it). With none running, the CLI changes the files itself. Limits:

- Conch's own assistant can't run `routines pause|resume` (`lib/protect.ts`, `CONCH_POWERS`). It
  pauses with `update_routine` (now with a `reason`), and only a person turns one on.
- A draft is never turned on from the terminal: "agent proposes, user confirms" (ADR 0006).
- `export` (`conch.routines/1`) holds the instruction, the schedule with its timezone and as cron
  where cron says it exactly, the next runs, the trigger, where results go (the chat apps its
  instruction sends to), the paths and pages it names, and the provider and model. Never a key,
  a secret or a hook's address.

**2. Asking the person, on Conch's own screen.** When someone other than the person asks
(another agent at the door, or words in a chat they didn't write), the assistant calls
`ask_owner_about_routines` with names and a reason. That makes a `RoutineRequest`
(`routines/requests.ts`): a card at the top of Routines and a notification ("Hermes asks to pause
“Weekly fitness recap”"), with **Pause it** and **Decline**. Only the owner's
`POST /api/routines/requests/:id/answer` changes anything.

- **Who asked is Conch's to say**: the name the person gave the key, or the chat's title, bound
  when the tool is handed over, never read from its arguments. The card says "A message in
  “Planning”" for a chat, never a name the words claim.
- **No consent from words**: the tool takes names and a reason only; no field, phrase or repeat
  ("the owner already approved") answers it. Tests send exactly that.
- **Only pausing, only what's on**: undone by turning it back on. Two waiting per asker, ten in
  all, three days each; kept in `routine-requests.json` (never backed up) across a restart.
- **The notification never allows from the lock screen** (ADR 0108): someone else's request is
  seen whole in Conch.

At the door (ADR 0112) a guest still gets no tools, with one exception: `TurnExtras.guestTools`,
tools that ask the person and do nothing by themselves. The manager hands a guest only those,
the guard and the permission path pass only those, and everything else is refused as before.
The A2A task stays `working` until the person answers; `GetTask` then says what they chose. The
agent card lists the `routine-handoff` skill.

**3. In Conch itself.** **More → Move to another agent** on a routine's page shows the export to
copy and pauses it with "Moved to ‹agent›". A paused routine says why
(`Routine.pausedBecause`: reason, who, when), cleared when it's turned on again.

## Consequences

- An agent never needs Conch's files or source: `conch help routines`, the
  [For other agents](../../apps/docs/content/reference/for-agents.md) page and the agent card say how.
- A program holding the person's own sign-in can still press anything they can. That's the
  sign-in's power, not this feature's; ADR 0153 keeps access keys for scripts from signing anyone out.
- `pausedBecause` is optional; a Conch before this one reads the routine without it and drops
  it on its next save. `routine-requests.json` and `here/routines/` are new and unread by older
  versions.
