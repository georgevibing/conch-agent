# 0056 — Routines that start from what happens, and a pulse that costs nothing

- Status: accepted
- Date: 2026-10-03
- Builds on: [ADR 0006](./0006-routines.md) (routines),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0045](./0045-teams-matrix-wechat.md) (the public door),
  [ADR 0046](./0046-edit-by-hand-and-live-data.md) (where Conch's requests may land),
  [ADR 0037](./0037-direct-google-accounts.md) / [ADR 0048](./0048-google-apps-and-gmail-app-password.md) (Gmail and Calendar),
  [ADR 0021](./0021-connect-from-chat.md) (offers in the flow),
  [ADR 0020](./0020-backups.md) (what a restore names first)

## Context

Routines (ADR 0006) start at a time. Much of what people want from an assistant
starts from something else: "tell me when Anna replies", "let me know when this
page changes", "brief me before each meeting", "when the big task is done, tidy
up". Today the only way is a routine every 15 minutes that looks and usually
finds nothing, and every look is a whole model turn.

Other agents solve this two ways, and both cost too much:

- **A heartbeat.** OpenClaw runs a full agent turn every 30 minutes, on by
  default, reading a checklist and answering `NO_REPLY` when nothing needs
  attention. People report $18 overnight and $50–150 a month for mostly
  nothing; the fixes are knobs (a lighter context, a cheaper model per
  heartbeat). Hermes makes it opt-in per session, but each beat is still a turn.
- **Event hooks in config.** OpenClaw's `/hooks/wake`, mapped hooks and Gmail
  Pub/Sub, Hermes's HMAC webhooks and its cron pre-run script that answers
  `{"wakeAgent": false}` so polling is free until something changes. The last
  is the right idea; all of them are files and flags.

Conch's promise is that anyone can use it, it hides complexity, and it costs
nothing it doesn't have to.

## Decision

### One idea for people: Every… or When…

A routine starts either **Every…** (a time, as before) or **When…** (something
happens). There is no heartbeat to set up, no checklist file, and the words
"heartbeat" and "webhook" never appear in the main screens. A watch ("tell me
if…") is a When-routine whose job is to tell you.

What can start one, each described by Conch in words (never the model), the
way `describe(schedule)` does for times:

| When…                       | Words                                         | Where it looks                                                      |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| An email arrives            | "When Anna Smith emails you"                  | Gmail: the search the app already does (API or IMAP), every 2–3 min |
| Before a calendar event     | "15 minutes before each meeting with others"  | Google Calendar, read every 5 min, decided every 15 s               |
| A page changes              | "When example.com/pricing changes"            | The page's readable text, every hour by default (15 min at least)   |
| A file or folder changes    | "When something changes in Downloads"         | The system's file events, settled for 10 s                          |
| A background task finishes  | "When a background task finishes"             | Conch's own task events                                             |
| Another routine runs        | "After Morning briefing runs"                 | Conch's own run events                                              |
| Another app sends a message | "When another app sends a message" (Advanced) | An address on the public door                                       |

"Conch starts" was left out: catch-up (ADR 0006) already covers what was
missed while it was off, and a routine that runs on every restart and update
would surprise people more than help them.

### The pulse: no model until something happens

`routines/triggers/pulse.ts` is a loop in the gateway. It asks each source
whether anything new happened, with **no model call**: a Gmail search, a
calendar list, a page read, a file event. Zero When-routines is zero work; a
quiet day is a few small requests and no tokens. Only when a source reports
something new does a run start: a real conversation (`origin: routine`), with
`trigger: 'event'` and `event` saying what happened ("Anna Smith’s email") and
linking to it. A run with nothing to say still reports `nothing-to-do`, which
stays silent (ADR 0006).

- **Each thing once.** Sources give every item an id (a Gmail message id, a
  calendar event and its start, a page's text hash, a delivery id). The pulse
  keeps the last 500 per routine in `routines/when/<id>.seen.json`, with what's
  waiting and when it last ran, so a restart repeats nothing and loses nothing.
  The file is `derived`: a restored backup starts watching from now rather than
  replaying everything since.
- **Bursts become one run.** At most four event runs per routine an hour.
  Whatever arrives while one runs, or while the hour is full, waits and goes in
  the next run together (as Hermes merges missed ticks), up to 20 listed and a
  count of the rest. At most two routines run at once, as before; an event
  waits for a slot instead of being skipped.
- **Only if…** A routine may say "only if it’s about the invoice". The
  provider's cheapest model (`engine.complete`, the same `cheapModel` the
  memory tidy-up uses) reads the one event and the condition and answers yes or
  no, before the full agent is woken. A garbled answer, an error or a provider
  that can't complete wakes the routine anyway and the run says so: missing
  the email you waited for is worse than one extra run. At most ten checks per
  routine an hour; past that, events go through unchecked, said the same way.
- **Spending.** The pulse asks one seam, `RoutineSpend` (`allow(routineId)`,
  `record(routineId, usage)`), before an only-if check and before an event run,
  and records the check's usage. Routine spending limits (built alongside)
  plug in there; until then it allows everything. The card says what it costs
  in words: a When-routine is "Free until something happens".
- **Honest.** Conch only notices things while it runs, said the way routines
  already say it ("What only works while Conch is running"). Mail and calendar
  are searched from where the pulse last looked, so mail that came while Conch
  was off still counts when it's back; file changes while it was off don't.

No quiet hours: a run starts when the thing happens, because "tell me when Anna
replies" waited until morning isn't what was asked. Notifications go through
Web Push (ADR 0027), which the phone's own Focus and Do Not Disturb already
govern.

### Stored so an older Conch doesn't break it

ADR 0051 says new data a rollback mustn't lose goes in a new file. The trigger
and the only-if live in `routines/when/<id>.json` (kept, group `routines`). The
routine's own file keeps a placeholder schedule (`once` at 2000-01-01): the
version before reads it as a one-off that already passed, so it never runs it
and never sets it aside as broken, and a newer Conch finds the trigger again.
A run's `trigger: 'event'` is new; the version before skips those lines of the
history.

### Sources, one file each

`routines/triggers/{mail,calendar,page,folder,finished,hook}.ts`, each a
`TriggerSource`: `validate` (normalise, refuse in plain words), `describe`,
then either `check` (polled; the pulse sets the pace and backs off) or `watch`
(pushed). Each reaches the outside through a narrow seam, so a test is a fake:

- **Mail** asks `in:inbox -from:me after:<last look − 1 h>` with the senders
  and words, then reads each new message once (`readMail`). Its own sent mail
  and drafts never count (`-from:me`, and the `SENT`/`DRAFT` labels), so a
  routine replying by email can't start itself. People are picked from those
  you've written to recently (`GET /api/routines/people`, read from Sent);
  typing an address is the fallback.
- **Calendar** reads the next hours once every five minutes, and decides every
  pulse which event is due. Each event once, by id and start: a meeting moved
  to another time is a new meeting to prepare for; a cancelled or declined one
  is skipped (and an event about to go is read again to be sure it's still
  there). All-day events are not meetings.
- **A page** is read through `fetchLive` (ADR 0046) with no local reach and the
  page's own host only: never this computer, never your network, never Conch.
  What's compared is the readable text (`html-to-text`, without navigation,
  scripts, forms and pictures), line by line, with times, dates and "5 minutes
  ago" taken out. A change must still be there on a second read two minutes
  later, and lines that flip back and forth are learned and ignored, so rotating
  ads and counters don't wake anyone. The run gets what was added and removed.
- **A folder** is picked with the system's Open dialog (`POST /api/pick`,
  purpose `watch-folder`) or Nacre `PathPicker`, never typed first. It can't be
  where keys live (`lib/protect.ts`, the sandbox's secret places), Conch's own
  folder, a whole drive or the home folder itself. Changes settle for ten
  seconds, temporary and hidden files are ignored, and Conch's own writes don't
  count: files an assistant tool just wrote, and anything while this routine's
  own run is going. A folder that disappears is watched for again every five
  minutes. Only the names of what changed reach the run; it reads the files
  with its own guarded tools.
- **Finished** listens to Conch's own events: a task becoming done, unverified
  or failed; another routine's run succeeding. Chains can't loop: a routine
  can't follow itself or anything that follows it (refused when saving), and a
  run started by a chain carries its path, stopped at five.
- **Another app** gets an address on the public door (ADR 0045) at an
  unguessable `hookId` (32 random bytes), off unless someone creates one, under
  **Advanced**. See below.

A source's failure heals first (agreement 11): a Google token is refreshed by
`GoogleService` itself, a network failure is tried again with backoff (one
minute doubling to an hour), a missing folder is looked for again. When only a
person can fix it — Gmail signed out, the app turned off, the folder gone for
good, the door closed — the routine's card says so in a sentence, and **Repair
everything** shows it as `needs-you` with one action. A page unreachable for a
day is a warning. A source that recovers leaves a "Fixed on its own" note.

### Security

Threat model: everything an event brings — mail, page text, file names,
calendar descriptions and attendee names, a delivery's body — is written by
someone else, and the run that reads it can act. Who can reach the pulse: the
person (the editor), the assistant (it drafts routines), the senders of mail,
whoever edits a watched page, and for "another app", the internet.

- **Untrusted from the start.** An event run starts tainted (`extras.taint`,
  ADR 0028), so anything that could send things out or change the computer
  asks first, whatever its trust. The event is put in the run's first message
  as data between a random boundary, after the instruction, with a line saying
  it is information and never instructions (spotlighting, Hines et al. 2024);
  never in the system prompt. Greshake et al. (2023) is why: indirect prompt
  injection rides exactly this path.
- **Asks first by default.** A When-routine is `ask` unless a person chooses
  otherwise in the editor. One that may act without asking is a backup power
  (`routine-acts-on-events`), and so is an address another app can use
  (`routine-address`), so a restore names them (ADR 0020).
- **Agent proposes, person turns on.** `create_routine` can draft a
  When-routine (trigger, only-if) as a draft at `ask`; only the person's
  **Turn on** starts the pulse for it (security rule 7). The assistant can
  never choose a `hookId`, see a secret, or point a page watch inward: the
  fetch is checked at the moment of connecting, every redirect again (OWASP
  SSRF Prevention Cheat Sheet; the same guard as ADR 0046). An assistant
  changing a When-routine's trigger or only-if pauses it for review, like a
  changed instruction.
- **Another app's address.** The door (ADR 0045) is the only way in: loopback
  listener, nothing else behind it, 240 deliveries a minute per address, and
  the pulse's four runs an hour behind that. A delivery is at most 64 KB. A
  secret, made on request and shown once, makes it signed: the [Standard
  Webhooks](https://www.standardwebhooks.com/) headers (`webhook-id`,
  `webhook-timestamp`, `webhook-signature: v1,<HMAC-SHA256>`) or GitHub's
  `X-Hub-Signature-256`, compared in constant time (`timingSafeEqual`); a
  timestamp more than five minutes off is stale, and a delivery id seen in the
  last day is a repeat. Without a secret the unguessable address is the
  bearer, and a repeated body within ten minutes is refused. The secret is kept
  in a sealed file (`routines.secrets.json`, `lib/sealed.ts`), `secret` in
  backups and in `lib/protect.ts`. While the door isn't on, the routine says
  "Turn on its public address" with one button.
- **Little and seldom.** Page checks at most every 15 minutes, mail every two;
  the four-runs-an-hour guard holds for every source.

Sources: OWASP SSRF Prevention Cheat Sheet; OWASP ASVS 5.0 (V1 encoding of
untrusted data, V2 validation, V11 cryptography for HMAC and constant-time
comparison); Standard Webhooks specification (2024); GitHub, "Validating webhook
deliveries"; Greshake et al., "Not what you've signed up for" (2023); Hines et
al., "Defending Against Indirect Prompt Injection Attacks With Spotlighting"
(2024); Gmail API `users.messages.list` search operators; Google Calendar API
`events.list` (`singleEvents`, `status`); Node.js `fs.watch` caveats.

### People's experience

- **In chat**, "tell me when Anna replies" drafts a When-routine; the card says
  "When Anna Smith emails you", with Turn on, Try it now, Edit and Not now.
  **Try it now** runs once with the most recent matching thing when there is
  one (her last email, the page as it is now, the next meeting).
- **In the editor**, Starts: **Every…** | **When…**, then a short list of plain
  choices, each with its picker (people you mail with, a folder from the Open
  dialog, a page's address, how long before a meeting), an optional **Only
  if…**, and the sentence Conch will show.
- **Starters.** The ideas include "Before each meeting, a short brief", "When
  someone I'm waiting on replies", "When a page I care about changes" and
  "When a big task finishes". After Gmail or Google Calendar is connected from
  Apps, the dialog offers the one or two that fit, once; nothing is created
  until the person presses Turn on. A connection made from a chat doesn't: the
  person is in the middle of something.
- **⌘K** finds "New routine that starts when…".

## Consequences

- A When-routine's quiet days are free; its runs cost what a routine run costs,
  plus a cheap check when it has an only-if.
- Conch only notices things while it runs. Mail and calendar catch up when it's
  back; file changes don't.
- Gmail and Calendar are polled, not pushed: Pub/Sub would need a public
  endpoint and a Google Cloud topic per person, which is the opposite of
  simple. Two minutes is soon enough to "tell me when".
- The pulse is one more thing that can go wrong, so it joins Repair everything,
  backups (rules for `routines/when/*`, a power for each new trust), and ⌘K.
