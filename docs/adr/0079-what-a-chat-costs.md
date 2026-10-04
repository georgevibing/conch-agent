# 0079 — What a chat costs, and the limits that hold it

- Status: accepted
- Date: 2026-10-04
- Amends: [ADR 0005](./0005-usage-limits.md) (the monthly budget now holds chats), [ADR 0057](./0057-routines-cant-run-up-a-bill.md) (how a provider charges and what a turn cost are shared with chats)

## Context

The bill is the first thing people complain about with other assistants.
OpenClaw and Hermes users find out what a week of chats cost when the invoice
arrives. Conch already knew most of it, and showed almost none:

- Every `turn.completed` carried `usage`, and `Usage.costUsd` when the
  provider said, but no screen showed it.
- The ledger behind "$ today / $ left" (`usage.json`) counted only `costUsd`.
  The key-based engines (Anthropic, OpenAI, Gemini, DeepSeek…) don't send
  one, so their chats counted as free. Claude Code sends a list-price figure
  even on a Max plan, so those chats counted money nobody paid.
- The monthly budget was a gauge: "it never stops you" (ADR 0005). Only
  routines (ADR 0057) and `delegate` (ADR 0033) held back at a limit.
- A chat had no limit of its own, and the tasks and helpers it sent away
  spent apart from it.
- Picking a top model on a long chat changed the price of every reply after
  it by ten or twenty times, without a word.

## Decision

### Every turn says what it cost, the way its provider charges

- **How a provider charges is asked, never assumed** (ADR 0057), now in one
  place for chats and routines: `usage/billing.ts` (`Billings`, kept for a
  minute). This computer is `free`; a plan's usage window, or a subscription
  sign-in, is `plan`; anything else is `metered`.
- **`turn.completed` carries a `TurnCost`**, worked out by the gateway, never
  the model: money for a metered turn (the provider's figure, else list price
  from `usage/prices.ts`, else nothing — Conch doesn't guess); on a plan, the
  plan and its tightest window as last read, plus the list-price figure,
  shown as "of work", never as money spent; and `savedUsd`, what reading
  from the provider's cache saved at list price. Prompt caching itself is
  the engines' business (it lands with the engines' own change); this only
  says what it saved.
- **A chat adds itself up** in `ConversationSummary.spend` (`ChatSpend`,
  kept on the conversation's record): money, the cache's saving, turns on a
  plan, and the money its tasks and helpers spent (`tasksUsd`). A task's turn
  counts in its own chat and in the chat it was sent from
  (`Task.parentConversationId`).
- **The month counts money only.** `UsageService.recordTurn` takes the turn's
  cost: a plan's turns and this computer's add nothing; a metered turn adds
  its money, list-priced when the provider is silent. Naming a chat is
  counted the same way. Old turns are read back by the same rule.

### Shown calmly

- **Each reply** has its cost among its actions (Nacre `TurnCostTag`): a quiet
  "$0.04", or "Plan". A tap opens the detail: the cache's saving, the tokens,
  the plan's window ("Current session: 42% used"). Nothing at all for this
  computer, or a model Conch can't price.
- **Each chat** has a chip beside the model picker (`ChatSpendChip`) once it
  has spent money or has a limit: "$0.31", "$1.70 of $2". It opens what was
  spent, by what, and the chat's own limit. ⌘K "What this chat spent" opens it.

### Two limits, and one tap at either

1. **The chat's own limit** (`spend.capUsd`), off until a person sets one in
   the chip.
2. **The monthly budget** (Settings → Usage) now holds every chat you write
   in, whichever provider is the default. At 80% of it (`BUDGET_NEAR_PERCENT`)
   the chat that crossed it says so in one quiet line, once a month.

Only money counts: a turn on a plan or on this computer always goes. Both are
checked before a turn starts (`ConversationManager.#capped`) and as it goes,
on each `usage` event (a running total, ADR 0057), so a tool loop stops within
a request of the limit rather than at the end.

At a limit the message waits (`turn.capped`, held like a message waiting for
the internet, and found again after a restart). A reply that went past it part
way stops cleanly (`during`) and carries on from there. The card says it in
one sentence and offers three choices (`POST /api/conversations/:id/capped`):

- **Raise to $X**: twice the chat's limit, or half again the month's, rounded
  to an amount a person would pick (`raiseTo`). The message goes.
- **Use <model>**: one already set up that costs less (`SpendDesk.cheaper`):
  on this computer first, then on a plan (neither spends money), then, at a
  chat's own limit only, one on a key at a third of the price or less — with a
  little more room (`allowance`: a quarter of the limit, at least 50¢), said on
  the button. A model that can use apps comes first when the chat's can.
- **Stop here**: the message stays unanswered, and nothing goes by itself.

Once chosen, the card folds to a quiet line, and the chat carries on.

**Tasks and helpers** share the limit of the chat they came from. One that
meets it stops cleanly and says why on its card; one sent while the chat is
already past it doesn't start. `delegate` still refuses past the monthly budget
(ADR 0033).

**Routines keep their own guards** (ADR 0057) and are counted in the month,
not held by it. Chats from a chat app (Telegram, Slack…) are counted but not
held: nobody there can tap the card. Both say what they cost the same way.

### Before an expensive step, when it really matters

Picking another model for a chat (`ConversationManager.configure`) works out
what a reply like the last one would cost with it, at list price and with
nothing from the cache (a new model starts cold). It says so in one line
(`spend.notice` `pricier`) only when that's at least $0.25
(`ESTIMATE_FROM_USD`) and at least twice what the last reply cost: "With a
chat this long, each reply from Opus 5.5 costs about $0.84. The last one cost
$0.21." Nothing for a short chat, a cheaper model, a plan or this computer.

### Only a person spends more

The chat's limit (`PUT /api/conversations/:id/spend-limit`), the choices at
a limit, and the budget are reached only from the UI (AGENTS.md security 7).
No tool sets them; a task can't raise its parent's limit.

## Consequences

- The "$ today" figure changes for some people: a Claude Code plan's turns no
  longer count as money, and key-based chats now do. Both were wrong before.
- A model Conch can't price spends without a limit stopping it mid-reply: the
  limit can only see money it can count. The provider's own figure, when it
  sends one, still counts.
- The monthly budget checks the month as the turn starts; another chat
  spending at the same time is seen by the next turn, not this one.
- A chat app's chats and routines run past the budget by design; ADR 0057's
  routine limit is the guard there.
- New engines get all of this by reporting `usage` (with `cachedInputTokens`
  when they read from a cache), and `costUsd` when the provider prices it.
