# 0129 — Tasks start when there's room, and say why they wait

- Status: accepted
- Date: 2026-10-10
- Amends: [ADR 0033](./0033-hand-it-off.md) ("Limits": no fixed count any more)
- Builds on: [ADR 0094](./0094-staying-responsive.md) (one admission signal, the shared pace),
  [ADR 0103](./0103-the-chat-tells-what-the-assistant-is-doing.md) (who does a chat's small jobs),
  [ADR 0126](./0126-the-next-one-with-room.md) (a provider at its limit hands on)

## Context

At most 3 background tasks and 4 helpers ran at once (`BACKGROUND_AT_ONCE`, `HELPERS_AT_ONCE`).
Asked for five things side by side, Conch ran four; the fifth said **Waiting** and nothing
more. The numbers were wrong both ways. A laptop with 8 GB and a build running can't take four
helpers that each start a coding agent and run the tests. A 16-core workstation sending five
web lookups to a model somewhere else could take twelve. And "waiting" with no reason reads as
broken.

What a scheduler can know before and while a task runs:

| Signal                     | Where it comes from                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This computer's size       | Processors and memory, the cgroup limit when there is one (`recovery/resources.ts`)                                                                           |
| How it is right now        | The shared, cached sample (`ProcessService.resourceSnapshot`, at most one a second) and the pace it feeds (`recovery/pace.ts`), already polled by the gateway |
| Whether automatic work may | `GatewayRecovery.allowsWork` (and `allowsPlanned` for work a person asked for just now): ADR 0094's one admission signal                                      |
| Managed commands           | `ProcessService.running`: builds and test runs started through `process_start`                                                                                |
| How a provider's work sits | A program of its own here (a coding agent, a vendor's CLI), a model on this computer, or a model somewhere else: `Engine.local` and the catalog's `group`     |
| What a task will ask       | Its words, and, when one may be asked, the provider's small model                                                                                             |
| A provider's own pushback  | `notice` `rate-limit` during a turn, a turn that ends `limit` or `unavailable`, `Engine.onLimits` `rejected`                                                  |

## Decision

### 1. An estimate for every task, never waited for

When a task is made, `tasks/estimate.ts` gives it an estimate from rules at once
(`ruleEstimate`): weight (`light`, `medium`, `heavy`), what it mostly uses (`cpu`, `memory`,
`disk`, `network`, `model`), about how many minutes, and the files its words say it changes.
Then one question goes to a small model for the whole batch (`planWork`): one per `delegate`,
one per background task. The model is picked as a title's is (`providers/small.ts`, gate
`plan`): the chat's own provider on its cheapest model, a private chat only its own provider or
one on this computer, nothing past the month's budget or a plan that's nearly used up. It's off
when the person turned **Name new chats automatically** off, since that switch is how they say
"no small-model calls for niceties".

- Only the parts' titles and instructions go, marked as data. Never the chat.
- The answer is read strictly with Zod (`readPlan`). A part it got wrong keeps the rules'
  estimate. It may only make a part heavier than its words plainly are, add conflicts, and set
  an order that points back to an earlier part (so there's never a loop). It grants nothing.
- Eight seconds, then the rules stand. A slow or failed answer isn't remembered; the same batch
  is asked once (`Recent`, 200 batches).
- Work never waits for it. Tasks start on the rules' estimate; when the answer lands, what's
  still waiting is weighed again.

The estimate is stored on the task (`Task.estimate`), so a resume or a restart keeps it.

### 2. Admit by room, not by count

`tasks/scheduler.ts` is a pure function, `schedule`, run on every change: a task added or
finished, the planner's answer, a provider's pause ending, Conch recovering
(`TaskService.reconsider`), and every five seconds while anything waits (an unref'd timer).

Each task has a cost: processors and memory from its estimate, plus how its provider runs (a
program here adds a process; a model somewhere else adds almost nothing; a model on this
computer adds its share of the processor). A task starts when, in this order:

1. what it starts after has finished, and nothing working (or ahead of it in line) changes what
   it changes;
2. the gateway says there's room for new work: `GatewayRecovery.room()`, checked in the same
   order as `allowsWork` (ADR 0094). It is the one notion of room: the same one that holds a
   provider's own shell commands, so a task never starts while a command would be refused, and
   its reason code (`memory`, `cpu`, `easing`, `recovering`, `not-measured`…) is the one a waiting
   task's words are made from. A busy or short-of-memory computer, or Conch recovering, holds
   everything;
3. its provider isn't pausing and has room (§4);
4. fewer than the ceiling are working: twice the processors, from 2 to 12;
5. with nothing of Conch's working, it starts, however big (the floor);
6. what's working plus it fits what the computer can spare: all processors but one, less half a
   processor per managed command, and all memory but the reserve and half a gigabyte;
7. it fits what the live reading says is free, less what tasks that started in the last minute
   will soon use (they aren't in the reading yet), keeping twice the reserve free, which is the
   pace's own warning line.

Requests are what Kubernetes and Nomad schedule by; the live check stops Conch from adding
work to a computer that's already busy with something else.

**Hysteresis.** Once a task waited for memory or the processor, the next needs a quarter more
than its cost free. The pace's own hysteresis (reduce at once, restore one slot at a time)
still governs `allowsWork`. The number shown goes down at once and up only after it has held for
15 seconds.

**Order and fairness.** Each time a place opens, the next is from the chat with the fewest
working, then the oldest, so one chat's batch of six can't starve another chat's one task. Parts
of one batch start together when all of them fit now (gang scheduling); otherwise as many as fit.
One that has waited 90 seconds goes first, and what it needs is kept for it, so smaller ones
can't keep slipping past (backfilling with a reservation, as batch schedulers do). Nothing that
is working is ever stopped to make room.

`MAX_PARTS` (6) stays as a guard on what one `delegate` may ask for. The fixed counts are gone;
`background` and `helpers` remain only as test knobs.

### 3. Every waiting task says why

`Task.waiting` is `{ reason, words, on?, retryAt?, expectedAt?, canStartNow }`, with `reason`
one of `room`, `memory`, `cpu`, `after`, `conflict`, `provider`, `provider-busy`,
`recovering`. The words are short and plain:

- "Starts when “Web fetch” finishes"; "Starts when one of the 4 working finishes"
- "Starts after “Read the README”"
- "Starts when “Fix the login” finishes: both change auth.ts"
- "Waiting for memory: 3 heavy tasks working"
- "Waiting for the processor: 2 commands running"
- "Codex asked Conch to slow down", with `retryAt`, counted down on the card ("trying again
  in 20s", `waitingLine` in `@conch/protocol`)
- "Waiting while Conch recovers"

`expectedAt` is a guess from what's working (its start plus its estimate) and is said only as
"likely in about 3 min". A reason is written only when it changes, and never into the chat's
transcript (the `task` note still changes only with the status). `TaskList.capacity` and the
`task.capacity` event carry how many run at once right now and what holds the rest back ("4 at
once on this computer right now"). The batch card's header shows that line while something waits
for room; each waiting line shows its reason in place of a bare "Waiting".

**Start now.** A task that waits only for room (`room`, or a busy processor) may be started by
the person: **Start now** on its card and line, and in ⌘K. It goes past what the computer can
spare, at most two past the ceiling, and only while `allowsPlanned` holds (never while memory is
short or Conch is recovering). It never goes past a conflict, an order, memory, or a provider
that asked to slow down. `POST /api/tasks/:id/start-now` refuses anything else with a sentence.

### 4. Providers push back, Conch slows down

`ProviderPace` keeps a number per provider: 1 at a time for a model on this computer, 6 for one
that runs its own program, 8 for one somewhere else. A rate limit or an overload halves it (never
below 1) and pauses new work for as long as the provider asked, or 20 seconds doubling with each
strike, never more than two minutes, so a plan that's used up still reaches the fallback (ADR
0126). After two calm minutes it gets one more, a minute apart, back to where it started
(additive increase, multiplicative decrease). It lives in memory; a restart starts afresh.

## Consequences

- Five parts on a roomy computer all start; on a small one, fewer, and each waiting line says
  what it waits for.
- The scheduler reads no new signals of its own: the shared sample, the pace and the gateway's
  admission (ADR 0094). No second sampler, no model call per pass.
- A provider's 429 slows only that provider's tasks; the others carry on.
- A wrong estimate costs time, not safety: the live check and the gateway's admission still
  hold, and the floor still lets one through.
- Every provider takes part: the planner asks whichever small model `providers/small.ts` picks,
  and the mock engine answers the planner's question like one (`pnpm dev:mock`).

## Limits

- Estimates are guesses. A task the rules call light that compiles the world uses more than
  it was given until the next reading notices.
- Conflicts are known only from the files a part's words name, or the planner sees. Two parts
  that change the same file without saying so can still run together; worktrees remain the way
  to keep code-changing parts apart.
- The GPU isn't read. A model on this computer is held to one at a time instead.
- The managed command queue (`ProcessService`) still admits by the pace's slot count, which
  comes back sooner than `room()` does (one slot after 30 calm seconds, while `room()` waits for
  the pace to be fully normal). Tasks and a provider's shell share `room()`; folding the queue
  into it too is left for its own change.
- `admitsPlanned` (Start now, a chat paused for an update) now lets work go on when the pace is
  normal; before, a normal pace's `cause: 'recovery'` held it exactly when all was well.
