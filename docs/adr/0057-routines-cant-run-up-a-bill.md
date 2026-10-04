# 0057 — Routines can't run up a bill or eat your plan

- Status: accepted; amended by [ADR 0079](./0079-what-a-chat-costs.md): chats share how a
  provider charges and what a turn cost (`usage/billing.ts`), and have limits of their own
- Date: 2026-10-03

## Context

Routines (ADR 0006) run unattended, as often as every 15 minutes, and every run
is a full model turn. Until now nothing limited one, nothing added them up, and
nothing said what one would cost:

- **On a key you pay as you go**, an hourly routine on a top model costs real
  money quietly. Other agents leave this to configuration: OpenClaw offers a
  lighter context, an isolated session and a per-heartbeat model, and Hermes
  leans on jobs that are scripts instead of model turns.
- **On a subscription** (Claude Code, Codex, Copilot, Gemini CLI, Grok), money
  isn't the cost; the plan's usage window is. A routine that runs while the
  window is nearly used takes the last of it from the person's own chats.

Conch's promise rules out a configuration answer: protection has to be there
from the start, say what it's doing in plain words, and ask only when only a
person can decide (spending more).

### What a run costs, measured

From this Conch's own chats (`turn.completed` usage):

- One request on a pay-as-you-go engine carries Conch's instructions and tools
  again: **about 72,000 input tokens**, and the API engines don't use prompt
  caching, so every tool round pays for it in full.
- A morning briefing is **about four requests** (calendar, mail, weather, the
  answer): **≈ 290,000 input and 3,000 output tokens** (`TYPICAL_RUN`).
- Claude Code's own turns on Opus with its caching cost **$0.14–$0.47** each.

At list prices that makes one briefing about **$0.09** (Gemini 2.5 Flash),
**$0.30** (Haiku 4.5), **$0.39** (GPT-5), **$0.61** (Sonnet 5.5), **$1.22**
(Opus 5.5) and **$3** (Fable). Daily, that's $3–37 a month; every 15 minutes
on a mid-priced model, about $58 a day.

## Decision

### Know what each run cost

- **Engines say what a turn has used as it goes.** A new `EngineEvent`
  `{ type: 'usage', usage }` carries a running total mid-turn: the API engine
  after each request, Claude Code from each assistant message (sub-agents
  included), Codex from `thread/tokenUsage/updated`. `Usage` gains
  `cachedInputTokens`, so cached input is priced as such.
  `ConversationManager` hands it to `TurnExtras.onUsage`, and `TurnResult`
  now says which engine and model answered.
- **Money comes from the provider when it says** (`Usage.costUsd`: Claude Code,
  OpenRouter), **else from list prices** (`usage/prices.ts`: Anthropic,
  OpenAI, Google, DeepSeek, xAI families). A model that matches nothing has no
  price, and Conch says nothing about money rather than guess.
- **How a provider charges is asked, never assumed.** `RoutineSpend.billing`:
  `Engine.local` is free; `usage()` saying `plan` or `metered` decides; else a
  `subscription` sign-in is a plan and anything else is metered.
- **Summarising a long chat is spending too** (ADR 0055): the API engine adds the
  summary's cost to the turn and says so in a `usage` event before its next
  request, so the run limit sees it. Priced from the turn's model when the provider
  doesn't say, which can only overstate it.
- **Every run records a `RunCost`**: billing, money (and whether the provider
  or Conch priced it), and on a plan its share of the tightest window (the
  window read before and after the run, same window, no reset between).
- **Each routine says what it costs in one line**, worked out by Conch like
  its schedule text: "About $14 a month" (median of its recent runs × runs a
  month), "Roughly $18 a month" before it has run (a typical run on its
  model), "About 4% of your Claude Max limit a run", "Runs on your Claude Max
  plan", "Free on this computer", or nothing.

### Three guards, on from the start

1. **One run's limit.** A run stops cleanly (the conversation is interrupted)
   once it has used **three times its routine's usual** (median of its last
   runs on that model), or before it has a history, **three times a typical
   briefing on its model**, and **never less than $1**; with no price it's
   counted in tokens (three typical runs, 879,000). Three times leaves every
   normal run alone, including a heavier day, and stops a tool loop within a
   few requests: on Opus 5.5 at ~$0.29 a request, after about thirteen. The
   run ends as `needs-you` with `guard: 'run'` and one sentence; **Let it use
   more** sets `runLimitUsd` on that routine (three times the limit), and Edit
   sets an exact amount. On a plan the same measure (notional cost) applies,
   said as "far more than usual". Free runs aren't limited.
2. **A monthly limit for everything unattended**, counting only money: every
   routine run whatever started it (schedule, catch-up, the event-started
   runs coming with "When…" triggers), and the checks a routine makes before
   it runs. **$20 until a person sets one**: it covers a daily briefing on the
   mid-priced models people choose for pay-as-you-go ($3–18 a month), and stops
   the runaway case (every 15 minutes, ≈ $58 a day) within about eight hours.
   A daily briefing on a top model (≈ $37) reaches it mid-month, and its card
   has said "About $37 a month" since before its first run. At the limit, runs
   that cost money are skipped (one `skipped` run with `guard: 'month'` per
   routine per month, not one per tick) until the 1st or a higher limit. The
   person hears about it **once a month**: a push notification, chat apps with
   routine results on, a card on the Routines page (**Raise the limit** /
   **Keep paused**), and a `needs-you` item in Repair everything. Runs on a
   plan or on this computer carry on.
3. **Room on a plan.** A routine doesn't start while any plan window is **80%
   used** or more (`PLAN_ROOM_PERCENT`): the last fifth, about an hour of a
   5-hour session at an even pace, is the person's. The run is recorded once as
   `skipped` with `guard: 'plan-room'` ("Waited so your own chats have room"),
   held, and goes as a catch-up once the window has room, unless the routine's
   next time comes first. This heals itself, like a run held for a signed-out
   provider (agreement 11).

**Run now** is a person asking: it isn't held by guards 2 or 3, but it is
counted, and guard 1 still watches it.

### Only a person spends more

The monthly limit (`PUT /api/routines/spending`) and a routine's `runLimitUsd`
are changed only from the UI (AGENTS.md security 7). The agent's
`update_routine` passes only the fields it offers (title, summary, prompt,
schedule, pause), and `create_routine` never sets a limit. A limit above the
default, or none, is a backup power (`routines-spend` in `backup/powers.ts`),
so a restore says so first; on restore the ledger merges (money already
spent stays counted).

### Cheaper where it's free to be

Conch doesn't quietly move a routine to a smaller model: a briefing written by
a weaker model is worse, and the person chose the model. Instead the routine's
model is visible and changeable in Edit, and `create_routine` takes `light:
true` for simple jobs (a reminder, a yes/no check), which pins the provider's
small model (`cheapModel`), never a bigger one.

### For "When…" routines: the API

`RoutineSpend` (`routines/spend.ts`) is the one place unattended spending goes
through. A routine started by an event is a run with another `trigger` and
needs nothing new. An "only if…" pre-check calls:

```ts
// Before: may anything that costs money start now?
const allowed = await services.routineSpend.allow(routineId, engine);
if (!allowed.ok) /* skip, and say allowed.message */ ;
// After the check's completion:
await services.routineSpend.record(routineId, completion.usage, { engine, model });
```

`record` counts money against the month (and tells the person if that crossed
the limit); `allow` says no at the monthly limit (`guard: 'month'`) or with no
room on a plan (`guard: 'plan-room'`).

### Where it lives

- `~/.conch/routine-spend.json`: the limit and USD per calendar month (backed
  up in the routines group, merged on restore).
- `GET /api/routines/spending`, `PUT /api/routines/spending { limitUsd }`,
  `POST /api/routines/spending/keep-paused`; `routines.spending` on the socket.
- Settings → Usage → **Routines** (the gauge and the limit), ⌘K "What routines
  may spend", the Routines page (cost on every card, the paused card), and the
  routine's page (cost per run, the guard's callout).
- Nacre: `RoutineCard` `cost`, `RunTimeline` `cost`, `RoutineSpendingGauge`,
  `RoutinesPaused`.

## Consequences

- A new provider gets costs for free: its tokens are priced if its family is
  in `usage/prices.ts`, it reports `costUsd`, or it declares `local`. One that
  can report usage mid-turn should emit `usage` events so the run limit can
  stop it before the end; one that can't is still counted when it finishes.
- List prices age. The table names its families, not every model, and a model
  it doesn't know is left unpriced rather than guessed: the run limit falls
  back to $3, or tokens.
- A plan share is the window's change across the run, so a chat at the same
  time counts toward it; the line says "about".
- A ledger that won't read starts its count again (and says so under Fixed on
  its own); the per-day spend in `usage.json` still has the month.

## Update (2026-10-04): room for your chats is yours to set

A one-off asked for "in a minute" waited five days for a weekly window at 81%, and
was marked done while it waited, so it never ran. Three changes:

- **The fullness is a person's choice**: 70, 80 (still the default), 90 or 95% used,
  or never wait (`planRoom` in `routine-spend.json`, `PUT /api/routines/spending`
  `{ planRoomPercent }`). The Routines page shows it once a routine runs on a plan
  (Nacre `PlanRoom`), with a line per plan saying what the choice means right now.
- **A routine can run regardless** (`runOnFullPlan`: "Always run this one",
  "Run even when the plan is nearly used" in Edit). Like the limits, only a person
  sets it; the routine tools don't offer it. Changing either looks at held runs
  at once (`RoutineService.recheckHeld`).
- **Waiting is not done.** A one-off held for room, the month or its provider stays
  on, shows when it goes as its next run, and completes only after it ran. Held runs
  are rebuilt from history after a restart (`#restoreHeld`), and a one-off an older
  Conch marked done while it waited is put back, with a note under Fixed on its own.

A routine drafted in a chat also runs on that chat's provider and model now (the
person picked them there, often to spare a plan), and a routine's run gets Conch's
own tools like a chat from a chat app, without the routine tools: your apps, Conch
apps, the browser, and `message_user` to write to you in any connected chat app.
