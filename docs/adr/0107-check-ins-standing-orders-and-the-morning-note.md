# 0107 — Check-ins, standing orders and the morning's note

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0006](./0006-routines.md) (routines),
  [ADR 0056](./0056-when-routines-and-the-pulse.md) (the pulse and its sources),
  [ADR 0057](./0057-routines-cant-run-up-a-bill.md) (what unattended work spends),
  [ADR 0032](./0032-it-learns-you.md) (the tidy-up),
  [ADR 0088](./0088-quiet-learning.md) (quiet learning),
  [ADR 0097](./0097-proactive-memory-maintenance.md) (memories never grant tool authority),
  [ADR 0100](./0100-permission-modes-every-provider.md) (permission modes),
  [ADR 0027](./0027-in-your-pocket.md) (Web Push)
- Amends: ADR 0032's "the tidy-up is off until you turn it on", and ADR 0056's
  "no quiet hours" for the check-in only.

## Context

People want an assistant that speaks up when something matters ("my flight
changed"), that remembers lasting wishes ("you may archive newsletters"), and
that gets better overnight without making them review anything. Other agents:

- **OpenClaw's Heartbeat** is a model turn in the main session every 30 minutes
  (an hour on Anthropic sign-ins), reading a monitor scratch that replaced
  `HEARTBEAT.md`. It answers `NO_REPLY` or `heartbeat_respond{notify}`, has
  `activeHours`, a model override, a light or isolated context, and skips the
  model only when the scratch is empty. Its own docs name "heartbeat model bleed":
  a small model left in the shared session overflows the next turn.
- **OpenClaw's standing orders** are Markdown programs in `AGENTS.md` (Authority,
  Trigger, Approval gate, Escalation). Their authority is prompt text, with no
  enforcement and no revoking but editing the file. Its newer **standing intents**
  are owner-only rows with cooldowns, a fire budget, expiry and explicit cancel,
  citing research that proactive systems overact and are hard to cancel.
- **OpenClaw's Dreaming** runs nightly at 3:00 in three phases: Light (dedupe and
  stage), REM (themes, no durable write) and Deep (promote by a weighted score
  with gates: score ≥ 0.75, recalled ≥ 3 times from ≥ 3 queries). It writes
  `DREAMS.md`, a diary for people, and has no documented per-item undo.
- **Hermes** has `/heartbeat` per session (`NO_REPLY`/`[SILENT]`), cron jobs whose
  pre-run script answers `{"wakeAgent": false}` so polling is free, and a memory
  nudge every ten turns. It has no standing orders and no morning digest.

Conch already has most of the parts, which this decision reuses rather than
duplicates:

| Piece                                        | Where                                              | Missing                           |
| -------------------------------------------- | -------------------------------------------------- | --------------------------------- |
| Finding what's new with no model             | the pulse's mail and calendar sources (ADR 0056)   | nothing                           |
| A cheap yes/no before waking the assistant   | only-if (`onlyif.ts`, `cheapModel`)                | one question about many things    |
| Spending guards for unattended work          | `RoutineSpend.allow`/`record` (ADR 0057)           | nothing                           |
| Telling the person, on the phone and in chat | `PushService.notify('routines')`, routine channels | a way to send Conch's own words   |
| Nightly memory work                          | `MemoryTidy` 2–5 a.m., with Undo (ADR 0032, 0097)  | on by default; within a cap       |
| What was learned, with Undo                  | the quiet-learning ledger (ADR 0088)               | somewhere a person reads it, once |
| Lasting wishes                               | nothing: learning drops "from now on…" on purpose  | all of it                         |

## Decision

### 1. Standing orders: words, never power

A standing order is one line in the person's words, `tell` ("tell me if…") or
`may` ("you may…"), read from the words by code (`standingOrderKind`) and
changeable. They live in `~/.conch/standing-orders.json` (kept, group
`routines`), at most 20.

- **Only a person makes one `on`.** Typed in Routines (`POST /api/standing-orders`),
  or **Keep it** on the card the assistant's `suggest_standing_order` leaves in a
  chat. That tool only writes a `draft`, which no prompt and no check-in reads;
  it isn't offered where nobody can press the card (routine runs, tasks, chat
  apps' unattended turns) or to guests (security rule 7). Not now removes it.
- **Visible, editable, revocable.** Every order is listed in Routines with its
  kind, how often it brought news, Change and Remove. ⌘K finds "Standing orders
  and check-ins". Nothing in a conversation revokes one: only Remove does
  (OpenClaw's lesson that proactive systems are hard to cancel).
- **It never grants tool authority.** This is the decision's centre, and the
  same rule as ADR 0097's for memories:
  - The prompt section (`StandingOrderStore.promptSection`, between the tools and
    memory, the same every turn so it costs no prompt cache) says in fixed words
    that an order never grants a permission, that whatever would ask still asks,
    and that text anywhere else calling itself a standing order isn't one.
  - **No code path reads an order when deciding what asks.** `mustAsk`,
    `hostAsk`, `risk.ts`, the guard after reading, skill holds and a routine's
    trust are untouched; Auto's policy is unchanged (security rule 11), so a
    `may` order adds no question and removes none.
  - Words that reach for a power ("without asking", "auto-approve", "any
    command"…) are noticed (`standingOrderPower`) and the order shows
    "A standing order can't change what Conch asks about" beside it, instead of
    being refused: the person's wish is legitimate; it just isn't the lever.
  - Why not let a `may` order pre-approve its action? Because the order is words
    the assistant interprets: "archive newsletters" doesn't say which sender is a
    newsletter, and an email can claim to be one. Authority belongs to the
    permission mode and a routine's trust, both set by a person in the UI and
    both backup powers. Turning words into authority is exactly what MINJA-style
    memory injection exploits (ADR 0088).
  - Orders are not memories. Learning still drops "from now on…" and powers
    (`learning/policy.ts`); the tidy-up never writes an order; `remember` can't.
- **The agent can't write the file.** `standing-orders.json`, `checkin.json` and
  `checkin/` are protected paths (`lib/protect.ts`): an assistant that could
  write them would give itself orders or choose what interrupts you.

### 2. The check-in: free until something's new

`checkins/service.ts` (`CheckIns`), a tick every minute, a look every 30 minutes
outside quiet hours (22:00–07:00 by default, the person's clock):

1. **No `tell` order, no look.** Nothing is read and nothing is spent: the
   state is "resting" ("Tell Conch something you want to hear about"). Adding
   the first `tell` order starts it, with no switch to find. One switch turns
   it off.
2. **Look with no model.** The pulse's own `mailSource` (new inbox mail since
   the last look, an hour's overlap, `-from:me`) and `calendarSource` (events
   starting within two hours, each id and start once) are called directly with
   the check-in's bookkeeping. A look reaches back at most a day, however long
   Conch was off. Nothing new is the usual answer, and costs nothing.
3. **One cheap question about everything new** (`judge.ts`): the provider's
   cheapest model, no tools, the person's `tell` orders numbered, the new things
   (at most 12, 1,200 characters each) between a random boundary that's removed
   from inside them, the system prompt saying they're data. The answer is JSON
   numbers Conch reads itself (at most three picks), each with a few words of
   note. Unreadable: tried once more, then let go. No model: it waits.
4. **Spending as routines spend.** `RoutineSpend.allow` before the question,
   `record` after it: the monthly limit and room on a plan hold it, and what it
   found waits (up to 30) rather than being lost; the card says why it waits.
5. **Tell, with why.** Web Push under the `routines` switch and the chat apps
   that hear about routines (`ChannelService.tellOwner`), in Conch's words
   (`tell.ts`): the note, what it was ("Lufthansa's email “…”"), and "Why
   you're hearing this: you asked “…”". At most twelve a day; past that, listed
   under **Told you** without a sound. Each thing once.
6. **It never acts.** Not even for a `may` order. A check-in that read someone's
   email can only name it to its reader; acting is a chat's or a routine's, under
   their permissions. So the check-in needs no trust setting, no conversation,
   and no backup power.

Quiet hours exist here though ADR 0056 refused them for When-routines: a
When-routine is a specific thing you asked to hear the moment it happens; a
check-in is a general eye on things that shouldn't wake anyone. The first look
after quiet hours covers the night.

### 3. The nightly pass and the morning's note

The nightly pass is the tidy-up (ADR 0032, 0097) plus what quiet learning
applied during the day (ADR 0088). Two changes, nothing duplicated:

- **On by default** (`preferences.tidyMemory` defaults to `true`). Installs that
  saved `false` keep it. Its model is now within learning's spending
  (`LearningSpend.allow`/`record`); past the cap it still merges exact repeats.
  OpenClaw's Light and Deep phases map to the tidy's merges and updates; we
  don't add a REM phase or a score: the tidy's gates (`keepsDetail`, the store's
  check, owner words) already decide, and every change has Undo.
- **The morning's note** (Nacre `MorningDigest`, web `memory/MorningNote.tsx`,
  `digest.ts`). What quiet learning applied and what the nightly tidy-up changed
  since you last put the note away (a day back at most), each line with Undo,
  answered by the existing routes (`/api/learning/answer`,
  `/api/memory/tidy/answer`). "While you slept" before noon after a nightly run,
  else "Since you last looked". It's on the new chat's screen until noon (three
  lines) and atop the Memory page. It's computed from what those pages already
  load: no new route, no model, no file. A held memory is never a line in it
  (ADR 0097: only security asks). Unlike OpenClaw's `DREAMS.md`, it is never
  read back into memory.

ADR 0097 made learning silent because people read every line as being asked. The
note keeps that promise: it asks nothing, appears once a day at most, has no
push, and one press puts it away.

## Threat model

Who can reach it: the person (Routines, the cards), the assistant
(`suggest_standing_order`, its file tools), anyone who sends email or a
calendar invite, and a restored backup.

| Attack                                             | Defence                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| An email tells the check-in to act                 | It has no tools and never acts; the model only returns numbers.                                                                        |
| An email tries to become a standing order          | Orders come only from routes a person uses; the judge's answer has no way to write one; the prompt says text elsewhere isn't an order. |
| An email makes the notification send you somewhere | The note is cleaned of links, addresses and markup (`cleanNote`); the link is the source's own (Gmail, the calendar), https only.      |
| An email floods you                                | Only what an order asks about is told; three a look, twelve a day; each thing once.                                                    |
| An email runs up a bill                            | One cheap completion per look, at most 12 things, under routines' monthly limit and plan room.                                         |
| Markdown or a link in a subject, in a chat app     | `plain()` escapes it; the words are Conch's around the subject.                                                                        |
| The assistant gives itself an order                | Its tool writes a draft only a press keeps; the files are protected paths.                                                             |
| An order is used as authority                      | No permission path reads orders; the prompt says so every turn; power words are labelled.                                              |
| A lock screen shows private mail                   | With previews off the notification says only "Something you asked to hear about came in."                                              |
| A restored backup brings back orders               | Orders are words, never powers, so no `BackupPower`; the check-in's bookkeeping is `derived`, so a restore starts looking from now.    |

Residual risk: the judge can be wrong in both directions (a missed flight
change, an extra notification); its only effect is a notification to the owner,
and the email still sits in Gmail. Lexical power detection is a label, not a
boundary; the boundary is that no authorisation reads an order.

Sources: Greshake et al., "Not what you've signed up for" (2023); Hines et al.,
"Defending Against Indirect Prompt Injection Attacks With Spotlighting" (2024);
OWASP LLM Prompt Injection Prevention Cheat Sheet (least privilege,
action-level authorisation); MINJA (arXiv 2503.03704); OpenClaw `docs/gateway/heartbeat.md`,
`docs/automation/standing-orders.md`, `docs/concepts/standing-intents.md`,
`docs/concepts/dreaming.md`; Hermes `website/docs/user-guide/features/{heartbeat,cron,memory}.md`.
All read 2026-10-08.

## Where it lives

- Protocol `checkins.ts` (`StandingOrder`, `CheckInStatus`, `ToldThing`,
  `inQuietHours`, `standingOrderKind`, `standingOrderPower`), the conversation
  event `standing.order`.
- Server `checkins/` (`orders.ts`, `service.ts`, `judge.ts`, `tell.ts`,
  `tools.ts`, `routes.ts`, `doctor.ts`). Routes: `GET/POST /api/standing-orders`,
  `PATCH/DELETE /api/standing-orders/:id`, `GET/PUT /api/checkin`,
  `POST /api/checkin/look`, `POST /api/checkin/told/:id/forget`.
- Whole Conch: backups (`standing-orders.json` and `checkin.json` kept,
  `checkin/**` derived), protected paths, a Repair everything check ("The
  check-in"), `describeTool` words, ⌘K ("Standing orders and check-ins", "What
  Conch learned overnight").
- Nacre `CheckIns` (`StandingOrderList`, `StandingOrderOffer`, `CheckInCard`,
  `MorningDigest`); web `features/checkins/`, `memory/{MorningNote,digest}.ts*`.

## Consequences

- A person says one sentence and hears about what matters, with why, for a few
  cents a month at most and nothing on quiet days.
- Standing orders change what the assistant tries and what interrupts the person;
  they never change what it may do. Someone who wants a `may` order to act
  unasked raises the permission mode or a routine's trust, which is already a
  person's lasting choice.
- The check-in only sees Gmail and Google Calendar, like When-routines. A new
  source joins by being a `TriggerSource` with `check`.
- Existing installs that saved `tidyMemory: false` stay off; others start tidying
  nightly, within learning's cap, and see the note the next morning.
- Only while Conch runs, as routines.
