# 0149 — Auto learns your environment

- Status: accepted
- Date: 2026-10-26
- Builds on: [ADR 0033](./0033-hand-it-off.md) (a task has its chat's powers, and never more),
  [ADR 0100](./0100-permission-modes-every-provider.md) (Auto's risk policy),
  [ADR 0128](./0128-auto-reads-what-you-asked-for.md) (what you asked for; Always allow in every
  chat), [ADR 0144](./0144-task-aware-auto-review.md) (the task-aware review)
- Amends: ADR 0144's "Synthetic task/routine messages … supply no owner authority", for work a
  person handed off

## Context

Auto asks only about real risk, and since ADR 0144 a review reads the person's own messages
before a question reaches them. Three gaps were left.

- **Handed-off work lost the person.** `#yourWords` gave nothing to a task or a helper, so a
  task's review had no owner messages and never ran. A push the person asked for in the chat
  became a question in the task, often as a notification.
- **Auto knew nothing about where you work.** Which hosts are yours, which bucket is scratch,
  what "production" means here. The reviewer had to guess from a command.
- **Always allow was coarse.** It lifts a whole class ("push code to a remote"). Someone who
  wants one push target to go ahead had to lift every push, or keep pressing Allow.

## Decision

### 1. Handed-off work keeps the person's authority

When a task or a helper is created from a chat (`TaskService.create`), Conch takes a frozen
copy of that chat's genuine owner messages, exactly what `#yourWords` reads there
(`ConversationManager.ownerWordsOf`). It is kept on the task (`Task.ownerWords`, optional, so
an older Conch reads the ledger as before) and handed to each run as `TurnExtras.ownerWords`.
In the task, `#yourWords` returns those words, each marked `FROM_PARENT_CHAT`, so the review
knows they were said in the chat the task came from.

- **Only from a person, alone.** The copy is taken only from a chat a person is in (Conch
  itself, or their own chat app) with nobody else's words in it. A routine, another task,
  another app's chat, a guest and a chat with a `person` taint hand on nothing. A task that
  later reads someone else's words loses them too.
- **The task's own prompt still grants nothing** (ADR 0144). It is Conch's words, written by
  the assistant or a template, and is never among them.
- **Never more than its chat.** The mode still goes through `noMoreThan`; the words are the
  ones the chat's own review would read. A scoped task (ADR 0038) takes no grants, so no words
  either. More words than a review can read whole (`OWNER_WORDS_MAX`) hand on nothing: a
  missing middle could hide where the person said stop.
- **Frozen means frozen.** The copy holds what the person said when they handed the work off.
  A later "don't push" in the parent chat is not seen by a task already sent; tell the task
  too, or stop it. We accept this because the alternative, reading the parent live, would let
  a task's authority change under it mid-step, and the task already follows its chat's mode
  live (`TaskService.#follow`): Ask first or a stopped chat still stop it.
- **Not shown elsewhere.** The page, other chats (`list_chats`, `wait_for`) and the task
  routes see the task without them (`taskShown`).

### 2. Your environment, in your words

`preferences.autoEnvironment` (`z.string().max(2000).default('')`) is the person's own note:
the hosts they trust, their remotes and buckets, what production means here. Settings →
Security → Safety shows it as one calm field, **What Auto should know about where you work**
(Nacre `AutoEnvironment`), saved as it's typed, and ⌘K finds it. Auto's review reads it as the
person's (ADR 0146). It is context for a judgement, never a rule: it can't lift a hard rule,
and a note that says "anything goes" is still read by a reviewer that may not waive keys,
money, the circuit breaker or a held step.

Only a person sets it:

- **No tool writes preferences.** The only writers are the settings route (a person's session
  or key), a chat app's own settings pages (the owner's presses, built by code), and the
  manager's own Always allow, which needs a press.
- **Nor does a file tool.** `settings.json` held the mode, the safety checks and every class
  Auto never asks about, yet no rule kept the assistant's file tools and shell from it. It is
  now a protected path (`lib/protect.ts`), like `tasks.json`: no read or write by the
  assistant's own tools, in any mode. This is stricter on purpose: an assistant that could
  write the file could give itself Full trust after the next restart. Nothing of Conch's reads
  it through the assistant's tools; the gateway keeps it in memory.
- **A backup names it.** The restore preview lists it as `auto-environment`, with the note's
  first words, so an old or someone else's backup can't quietly bring back what Auto trusts
  (ADR 0020).

## Threat model

- **The assistant can't mint authority.** The copy is read from the parent chat's own log by
  the gateway at creation. No tool argument, task prompt or route body carries it.
- **Someone else's words** never become the person's: a `person` taint in the parent at
  handoff, or in the task later, empties it.
- **Hard rules are unchanged.** The review still can't waive explicit Ask, Off, keys, money,
  the circuit breaker, `NEVER` risks, protected paths or a held step (ADR 0144).

- **A note is words, not power.** It reaches only the reviewer, inside its fence, as data.

## Tests

`conversations/handed-off.test.ts`: a task's review reads the chat's words, marked, and not its
prompt; the copy is frozen; a task with no inherited words asks; a chat with a guest's words
hands none on; a routine has none and hands none on; oversized history hands none on.
`tasks/service.test.ts`: the copy is stored, hidden from the list and events, and never taken
by a scoped or standalone task. `lib/protect.test.ts`: `settings.json` is out of the
assistant's reach; `backup/powers.test.ts`: a restore names the note; Nacre `AutoEnvironment`
and web `SafetySection` tests (axe), and ⌘K's.
