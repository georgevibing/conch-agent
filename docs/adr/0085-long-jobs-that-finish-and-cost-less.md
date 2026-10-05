# 0085 — Long jobs that finish and cost less: a turn budget, prompt caching, pages that say what changed

- Status: accepted
- Date: 2026-10-04
- Builds on: [ADR 0005](./0005-usage-limits.md) (budgets that never block),
  [ADR 0014](./0014-browser.md) (the browser), [ADR 0023](./0023-offline-and-limits.md)
  (retries and the fallback), [ADR 0033](./0033-hand-it-off.md) (a task has its chat's
  budget), [ADR 0055](./0055-long-chats-on-every-model.md) (fitting the window),
  [ADR 0057](./0057-routines-cant-run-up-a-bill.md) (what a turn has spent),
  [ADR 0079](./0079-what-a-chat-costs.md) (what a chat costs, its limit),
  [ADR 0060](./0060-the-chat-knows-conch.md) (one thing asking at a time)

## Amendment (2026-10-04): the limits are off until a person turns them on

A pause on steps, tokens or time made a chat someone was watching stop in the middle
of a legitimate job — and, on Codex, far too early: its `tokenUsage.total` is the whole
thread's, every earlier turn and every cached re-read included, so a long chat arrived
over the token limit before it began (the engine now counts this turn's share, less
what the thread had before its first request, with cached input named). Other
agents don't stop a watched job on a size limit, and the person is already watching.

So for a chat someone is watching, **`turnBudget` has no limit by default**
(`Infinity` steps, tokens and time; going over the monthly budget changes nothing).
Settings → Usage → **Long turns** (`preferences.turnLimits`: `on`, `steps`, `tokens`,
`minutes`) turns the budget below on, with the numbers a person chooses; it starts at
100 steps, 2M fresh tokens and 30 minutes. The watch for loops (§1, "The watch") is
not a size limit and always runs: a model repeating itself is still told, then paused.
Routines, tasks and guests keep their own budget (200, 4M, an hour) whatever the
switch says, because nobody is there to press Carry on and ADR 0057 depends on it.

## Context

On the model APIs, Conch runs the agent loop itself (`engines/api/engine.ts`).
Three things made long jobs fail or cost too much:

- **A hard stop at 24 tool steps.** A browser task (search, open, scroll, click,
  type, check out) takes more than that, so it stopped halfway with a notice that
  vanished as the turn ended. Nothing looked for the real danger: a model calling
  the same thing again and again. Codex and the ACP programs had no guard at all.
- **No prompt caching.** Every step sent the instructions, the tool list and the
  whole chat again, at full price. Nothing in `engines/api` asked Anthropic or
  OpenRouter to cache, and the memories that change every turn sat in the middle of
  the system prompt, so even automatic prefix caching (OpenAI, DeepSeek) broke there.
- **Whole pages after every action.** Each browser action answered with the full
  page, up to 16,000 characters, so a twenty-step task carried twenty copies of
  pages the model had moved past.

And an OpenRouter 429 without `retry-after` wasn't retried at all.

## Decision

### 1. A turn budget, a watch for loops, and a pause with Carry on

`engines/budget.ts` is pure: `turnBudget` and `TurnWatch`.

- **The budget** is steps (rounds of tool calls), fresh tokens (input not read from
  the cache, plus output) and time: 100 steps, 2M fresh tokens, 30 minutes for a chat
  someone is watching; 200, 4M and an hour for a routine or a task, where nobody can
  press Carry on. Over the monthly budget (ADR 0005), fresh tokens are halved — it
  checks in sooner and never blocks. A model on this computer counts no tokens and
  gets half as long again. The manager sets it (`TurnInput.budget`).
- **The watch** sees each call and its answer. The same call (stable JSON of its
  arguments) three times in the last twelve, four failures in a row, or the same long
  answer four times running is pointed out to the model in the result it reads
  ("[From Conch: you've made this exact call 3 times…]"); five, eight and seven
  pause the turn. Short confirmations ("Saved.") never count as "the same answer".
  Near 85% of the budget, the model is asked once to wrap up, so the pause lands on
  a sentence saying what's done and what's left.
- **A pause** is `done` with `outcome: 'success'` and `paused: {reason, message}`,
  carried to `turn.completed.paused`. The transcript shows one sentence and
  **Carry on** on the latest turn (a quiet line once the chat moves
  on); it's the one thing asking, so reply chips aren't added. Carry on sends
  "Carry on". The API engine keeps the reason in the session, and the next message
  starts with a note that the last turn stopped part-way — after a loop, to try
  another way — so the model picks the work up instead of starting again. Calls the
  turn paused before still get an answer, so the transcript stays valid.
- **Beside the chat's spending limit** (ADR 0079). A limit is money and a person's
  decision; a pause is pacing. When a reply runs past a spending limit, the limit's own
  card stops it, and a pause arriving at the same moment is dropped, so the two never
  stack. A pause within the limit is a pause, with no limit card.
- **Behind the Engine interface.** `Engine.turnBudget = 'own'` means the engine keeps
  the budget itself: the API engines, and Claude Code, whose program paces long
  coding sessions itself. For the rest (Codex, the ACP programs, the mock),
  `conversations/turn-guard.ts` watches from outside: Conch's own tools answer
  through the watch, so a loop there is nudged, then paused; the program's own tool
  calls are only seen go by, so a loop there is paused at the same count; calls stand
  in for steps (two to a step), and a timer pauses a program that has gone quiet past
  its time. Pausing aborts the engine through a signal only the guard holds, and the
  `done` that follows becomes the pause, never "Stopped". An ACP program's own
  `max_turn_requests` is the same pause.

### 2. Prompt caching everywhere it exists, and a prefix that stays put

- **Anthropic API** (`anthropic.ts` `cached`): four breakpoints — the last tool, the
  system prompt, and the last two messages on the person's side. The newest is what
  the next step reads; the one before is still there when the newest is shortened
  to fit (ADR 0055), and each is within the 20 blocks Anthropic looks back. Only the
  request is marked; the stored transcript is untouched.
- **OpenRouter** (`openrouter.ts` `cacheFor`), as it documents: Claude models get the
  system prompt as a marked text part plus the request's own `cache_control` (its
  automatic caching moves along the chat); Gemini takes one breakpoint, so it goes on
  the system prompt and the rest is implicit caching; OpenAI, DeepSeek and Grok cache
  by themselves.
- **A stable prefix for automatic caching.** Tools are sent in one order every
  request, and nothing in the system prompt changes by the clock. The memories a
  message brings up change every turn, so the manager now puts them after everything
  that stays the same (`memory/prompt.ts` `systemParts`).
- **Counted honestly.** `Usage.cacheWriteTokens` joins `cachedInputTokens`: read from
  Anthropic's `cache_creation_input_tokens`, OpenRouter's `cache_write_tokens`, and
  cache hits from `prompt_tokens_details.cached_tokens`, DeepSeek's
  `prompt_cache_hit_tokens` and Kimi's `cached_tokens`. List prices know the write
  premium (`usage/prices.ts` `cacheWrite`, Anthropic's 1.25×), so spend and routine
  costs reflect both. A reply's cost ([ADR 0079](./0079-what-a-chat-costs.md)
  `TurnCost`) is priced with the writes, and what the cache saved is net of them
  (`usage/billing.ts` `cacheSaving`): a request that only wrote to the cache saved nothing yet.
- **Measured** (`caching.test.ts`): a twelve-step turn over a ~25K-token prefix,
  against a pretend Anthropic with Anthropic's documented cache rules, costs $0.086
  instead of $0.405 on Claude Sonnet 5 — 79% less — with 91% of input read from the
  cache.

**Thinking that no longer matches.** Newer Claude models bind each thinking block to
everything before it, and Conch does change the past on purpose (summaries, stale
pages). A 400 that says a thinking block no longer matches is healed in the wire:
earlier thinking is dropped and the request goes once more (`withoutThinking`), as
Anthropic documents for blocks that can't be replayed.

### 3. Pages that say what changed

`browser/snapshot.ts` remembers, per tab, the page the agent last read. After an
action, `readChanges` returns a line diff against it (`pageDiff`: common start and
end trimmed, the middle compared, two lines of context, focus moving ignored) inside
`<page-changes>`. The whole page comes back, as before, inside `<page-content>`, when
the address changed, when more than 40% of it changed, when there's nothing to compare
with, and whenever the agent asks with `browser_read`. "Nothing on the page changed"
is said plainly: the action may not have worked.

**Stale pages go first** (`engines/api/pages.ts`). Once a chat passes three quarters
of its budget, every page view older than the newest whole one becomes a one-line note
of where it was, before any turn is folded into the summary (ADR 0055). It happens
when room is needed, not every step, so the cached prefix holds in between.

### 4. Retries with backoff and jitter, everywhere

A rate limit is retried whether or not the provider says how long: OpenRouter's 429
and every preset's (`mapChatError`) now are, once spent credit has been told apart
(that is never waited out). The engine waits what the provider asked, plus up to a
quarter second, or 1–2, 2–4, 4–8 seconds (equal jitter), at most three times, and
says so. Then the turn's `limit` or `unavailable` problem routes to the fallback
(ADR 0023). Anthropic's 429 without `retry-after` stays a spending cap, which waiting
never fixes; Ollama's busy server waits two seconds.

## Consequences

- Long browser and research tasks finish, or pause with one tap to carry on; a model
  stuck in a loop is told, then stopped, on every provider.
- A long turn on Anthropic or Claude through OpenRouter costs a fraction of what it
  did; OpenAI-style providers cache more of each request.
- A twenty-step browser task carries one whole page and some small diffs, not twenty
  pages.
- **Known limits:** the outside watch can't nudge a loop in a program's own tools (a
  Codex shell command), only pause it. Claude Code is trusted to pace itself. The
  thresholds are judgement, kept in one file, and measured against real runs.

## Revisited (2026-10-05): getting nowhere, not repeating

A Codex chat paused with "it kept trying the same thing" while it was checking, every
few seconds, whether a test run had finished, then finished within five minutes of
**Carry on**. The outside watch can't nudge Codex, so its first word was the pause, and
three of its rules were counting work as a loop: the same command five times (polling),
eight failures in a row (any non-zero exit: failing tests, a `grep` that finds nothing),
and the same answer seven times.

OpenClaw's loop detection is off by default; when on, it counts the same call with the
same result, resets on any meaningful change in the output (ignoring timestamps and
durations), warns in the tool result, and only ends the run on a second critical hit.
Hermes has no loop stop at all: a 90-step budget with warnings as it nears the end.

Now (`engines/budget.ts`): a loop is the **same call coming back with the same answer**
(times, clocks and durations taken out), each hard on the last. A changed answer is
progress; repeats 20 seconds or more apart are waiting, not looping. The model is told
at the third and sixth, and the turn pauses at the tenth. Failures in a row get one
word to the model and never pause it; the same long answer from different calls pauses
at twelve fast ones, and never for errors. A chat someone is watching still has no
step, token or time limit until they set one.
