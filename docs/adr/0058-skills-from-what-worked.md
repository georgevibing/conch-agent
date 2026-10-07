# 0058 — Skills from what worked, and a tidy shelf

- Status: accepted
- Date: 2026-10-03
- Builds on: [ADR 0013](./0013-skills.md) (skills),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading, the scan),
  [ADR 0031](./0031-skill-trust.md) (what a skill may do),
  [ADR 0032](./0032-it-learns-you.md) (skills you keep asking for),
  [ADR 0038](./0038-durable-verified-tasks.md) (verified tasks),
  [ADR 0047](./0047-skill-scope.md) (held for the whole chat)

## Context

ADR 0032 taught Conch to notice _habits_: the same request in three chats
becomes an offer to save a skill. It doesn't learn _procedure_. When the
assistant works out how to do something hard (twelve steps, two false starts,
then it worked), that know-how is gone when the chat ends, and the next time
it works it out again.

Others learn procedure, and both apply what they learn by themselves:

- **Hermes** nudges a skill every 15 tool iterations, and a background review
  writes or patches skills on its own. A curator marks skills it made stale
  after 14 days unused and archives them after 30.
- **OpenClaw's Skill Workshop** reviews substantial work (10 or more model
  iterations) and creates or patches skills with `mode: auto` by default, with
  no approval.

Applying them by itself is the risky part. A skill is instructions the
assistant follows with your powers (ADR 0028), and the work it's learned from
read tool output: web pages, email, files. That's the indirect prompt
injection pattern (Greshake et al., 2023; OWASP Top 10 for LLM Applications
2025, LLM01 and LLM06): text a page planted in one chat, written into a skill,
acts in every later chat. ClawHub's ClawHavoc campaign (February 2026) showed
how far a bad skill travels once it's on a shelf.

Conch's rule stays the one from ADR 0032: **the agent proposes, the person
keeps.** Nothing is saved, turned on or trusted by Conch.

> **Update (2026-10-05):** since [ADR 0088](./0088-quiet-learning.md), this rule covers
> skills only. Memories learned in a chat you were in, that read nothing from outside, are
> kept by themselves and said afterwards, with Undo.

## Decision

### 1. What counts as work that went well

`skills/learn.ts` (`assess`) reads a chat's log as turns: what you asked, each
step (a tool call, or a step the assistant took in the browser), how the turn
ended, and what it said last. Conch's bookkeeping (`remember`, `use_skill`,
a to-do list) isn't a step. Strongest signal first, a weaker signal needs more
steps:

| Signal                                                               | Steps |
| -------------------------------------------------------------------- | ----- |
| A background task that finished `verified` (ADR 0038)                | 3     |
| A routine's run that `succeeded`                                     | 4     |
| You said it worked ("perfect, thanks") right after it, with no "but" | 5     |
| A long run that ended well, with nothing said                        | 10    |

The work is the turn that ended it and the turns with steps just before it,
false starts included (a turn that failed, then "try again without that tool").
It's never kept when:

- the turn failed or was stopped;
- more than half its steps failed, or the reply says it didn't manage;
- a skill already shaped it (a `skill.used` in it);
- someone else's words are in the chat (a `person` taint): their words aren't
  yours to learn from, as in ADR 0032;
- it's like a skill you have, or one you turned down for good (checked before
  any model is asked, and again after).

It's offered **once per chat** (a routine once, however often it runs), never
while a turn runs, and no more than five wait at once. Every engine's chats
are read the same way: the log is Conch's, not the provider's.

### 2. The draft: the provider that already saw it, read like any skill

The cheapest model of **the provider that answered the chat** writes the
draft (`engine.complete`, as the tidy-up and titles do). That provider has
seen the chat already, so nothing goes to a company that hadn't. Without one
that can complete, a model on this computer may; otherwise there's no offer.
The cheap model gets one retry with the provider's own default model; the
chat is then marked, so a model is asked at most once per chat.

The prompt frames the chat as data (`<work>`, angle brackets defused): your
words, each step as Conch summarises it ("Run \`git log\`"), and the end of
the reply. Tool output itself isn't in it. The model is asked to generalise
(anything particular to this one time becomes what to ask for or look up),
keep what worked with a line for each lesson a dead end taught, and say
`worth: false` when it's a one-off.

`checkDraft` then reads the reply as strictly as any skill. Any of these and
there's no offer:

- not the JSON asked for, `worth: false`, a title or description the house
  style rejects, or instructions without at least two steps;
- a key, a token, a `password=`, or anything the vault's redactor would hide
  (ADR 0025);
- two or more of the specifics the steps used that you never typed (absolute
  paths, addresses, emails, the work folder): a replay, not a skill;
- anything `scanText` (the scan's rules, `skills/scan.ts`) calls dangerous,
  on the SKILL.md as it would be written.

### 3. After reading something from outside: offered, with a note, read stricter

A chat that read a web page, a file it downloaded or an app's content (taint,
ADR 0028) can still have done real work worth keeping: the train search, the
invoice round-up. Refusing every such chat would make the feature useless for
exactly the work people do in a browser. So it's offered, with two changes:

- **A stricter read.** A warning is enough to drop it (not only danger), and
  so is any web address in it that you didn't type yourself: an address is
  what a planted step needs most.
- **It says so.** The Skills page, the card in the chat and New skill all say
  where: "Learned from trains.example." (the chat card adds "Check the steps
  before saving."). New skill adds that a page can try to slip in a step of
  its own. Conch writes that sentence from the chat's marks
  (`skills/notice.ts`), each place once ("Yazio content" and an app from "a
  chat that read GitHub and Yazio content" are "Yazio and GitHub content"),
  never with a model: the model read what a page could have steered.

Someone else's words (a `person` taint) still produce nothing, as above.

### 4. It says only what the work needed, and is never on by itself

`permissionsOf` turns the steps that succeeded into a skill's list (ADR 0031)
with `needs()`, the same function that holds a chat to a list: commands
narrowed to the programs used when every command was plain (`git`, `npm`;
`sudo`, a script by its path or `$(…)` means any command, never a guess),
apps narrowed to the ones used, files anywhere only if a step wrote outside
the work folder. Work that only read declares nothing (`permissions: none`).
The draft carries that list, in the words its page will use, and New skill
shows it before you save. Once saved and used, the chat is held to it (ADR
0047): anything else asks first.

Conch's own tools on providers that run them as their own MCP server don't
appear as steps (the chat shows them in other ways), so a draft can say less
than the work did. That errs the safe way: the skill asks first.

Nothing is saved by Conch. **Look at the draft** (or the chat's **Save how I
did this as a skill**) opens New skill filled in and set to **When I ask**,
the same as a habit suggestion. Saving it sends the suggestion's id, which
settles the offer.

### 5. Where it shows

- **In the chat:** a small card under the reply that earned it, once the
  turn is over (Nacre `SkillOffer`): what the skill would do, in a few words
  ("Log a meal in Yazio"), one quiet line ("That took 12 steps, and it
  worked."), **Save as skill** and **Not now**. The few words are a
  `headline` the draft's model writes in the same reply as the draft (no
  second call), checked by `cleanHeadline` (short, one line, plain words, no
  address, path, secret or specific of this one time); without a usable one
  the card shows the draft's title. Once you write again it leaves the chat
  and waits on the Skills page. Never a dialog.
- **On the Skills page:** with the habits (ADR 0032), as the same
  `SkillSuggestionCard`, now saying where it came from: "From your chat
  'Trains to Lyon'. Save how it was done as 'Cheapest train'?" **Not now**
  (a month) and **Don't suggest this** (for good, and work like it stays
  down) behave as they do for habits.
- **⌘K:** **Save how I did this as a skill**, in a chat that earned one.

`GET /api/skills/suggestions/work` is separate from the habits' list, which
may wait on a model, so the chat can ask after every turn. The gateway says
`skills.offered` when a new offer lands.

### 6. A tidy shelf: off, not a new "archived"

Off already means everything an archive would: the skill is kept (its folder,
in every backup), never offered to the model, can't be asked for by name, and
one switch brings it back. A separate "archived" state would be a second word
for the same thing, so there isn't one. The shelf turns skills **off**, and
the Skills page gained an **Off** filter (`/skills?show=off`, ⌘K **Skills
that are off**, found by "archived" too).

`SkillUsage` (`skills/usage.ts`, `skill-usage.json`) records when each skill
was last used. Every way a skill is used ends in a `skill.used` event (typed
as `/name` from the composer, ⌘K or a chat app; a routine's instruction;
`use_skill`; carried into a task), so one listener on those counts them all.
It also records how a skill came to be here, when Conch put it there: saved
from a suggestion or from your work, or brought in by Come home (ADR 0035).

A skill is offered for turning off when Conch put it there, it's on, it works,
and it hasn't been used, made or kept for **60 days**. A skill you wrote
yourself is never offered, however long it sits, and neither is another
app's skill: Conch didn't put either on your shelf, so it doesn't tidy them.
One card on the Skills page (Nacre `SkillShelf`), "You haven't used these in
two months", with **Turn them off** and **Keep them** (asked again after
another 60 days unused). Looking changes nothing. The press is checked again
on the gateway: only skills still on the shelf at that moment are touched,
and turning off is the only change it can make.

### 7. Whole Conch

- **Backups:** `skill-learned.json` (offers, chats looked at, what you turned
  down) and `skill-usage.json` are `kept`, with skills.
- **Repair everything:** no new check. Both files are read through
  `readStore`, which sets a damaged copy aside, starts again and says so
  under "Fixed on its own"; nothing else holds state that can break.
- **⌘K:** **Save how I did this as a skill** and **Skills that are off**.
- **The mock engine** does work "the long way" (12 commands, two false starts)
  and drafts from it, so tests and `pnpm dev:mock` take the real path.

## Consequences

- Know-how the assistant worked out once can be kept in one press, with any
  provider, and it arrives as an ordinary skill: readable, editable, signed
  or not, held to its list.
- A poisoned page can't write itself into a skill: the draft is scanned,
  stricter after reading, says where it was learned, and still waits for a
  person to read and save it. A replayed one-off is dropped rather than
  offered.
- The cost is one cheap completion per chat at most, from a provider that has
  seen the chat already.
- The shelf only ever offers, only what Conch put there, and only turns off.
- **Known limits:**
  - Satisfaction is read from a short list of words in a few languages. A
    thank-you in another language falls back to the long-run signal.
  - A draft can't patch an existing skill. Work like a skill you have isn't
    offered at all; changing that skill is yours to do.
  - Skills from before Conch kept count have no record of how they came, so
    the shelf never offers them.
