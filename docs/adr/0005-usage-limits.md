# 0005 — Usage limits

- Status: accepted
- Date: 2026-09-29

## Context

People want to know how much they can still do before a turn gets refused, without
running `/usage` or opening claude.ai. What "a limit" means depends on how the engine
is signed in:

- A **subscription** (Pro, Max, Team, Enterprise) has rolling windows: a 5-hour
  session, a weekly allowance and sometimes per-model weekly windows, plus optional
  pay-as-you-go extra usage.
- An **API key, Bedrock, Vertex or Foundry** sign-in has no ceiling from the
  provider. You pay per token. The useful numbers are what you've spent and what's
  left of your own budget.

Conch must not talk to Anthropic's APIs itself (ARCHITECTURE principle 1). It also
must not read Claude Code's OAuth credentials.

## Decision

- **One provider-agnostic snapshot on the wire.** `UsageSnapshot`
  (`packages/protocol/src/usage.ts`) has these parts:
  - `kind` is `plan`, `metered` or `unknown`.
  - `source` is a human label such as "Claude Max" or "Amazon Bedrock".
  - `windows` lists each window's percentage used, reset time and severity, in
    display order.
  - `extra` is optional extra usage.
  - `spend` is today, this month and an optional budget.
  - `blocked` is set while sends are refused.

  `severityFor()` is shared, so server and web grade windows the same way.

- **Engines report plan limits; Conch reports spend.** `Engine.usage()` is optional,
  and so is `Engine.onLimits()`.
  - **Plan limits.** Claude Code answers metered sign-ins from `claude auth status`
    alone. For subscriptions it opens an idle SDK session (the same trick as
    capabilities) and calls the SDK's structured `/usage` control request. This is
    the data behind Claude Code's own `/usage`, and it makes no model request.
  - **Live hints.** `rate_limit_event` messages during a turn become `LimitSignal`s.
  - **Spend.** An engine without `usage()` is treated as metered.
- **`UsageService`** (`apps/server/src/usage/`) merges the two.
  - It keeps a per-day spend ledger in `~/.conch/usage.json`, seeded once from past
    `turn.completed` events.
  - It re-reads the provider when a turn ends (debounced), on each rate-limit hint,
    the moment a window resets, and every 5 minutes for plans. Plans get the poll
    because you may be using claude.ai elsewhere.
  - It pushes `usage.changed` over the WebSocket. REST offers `GET /api/usage`
    (`?refresh=1` forces a re-read, throttled to one every 15 seconds) and
    `PUT /api/usage/budget`.
- **UI: one fuel gauge, always in the same place.**
  - A `UsageMeter` chip in the header shows the tightest window as "% left" (or
    "$ left" of your budget, or "$ today"). Clicking it opens a `UsagePanel` with
    every window, its reset countdown and extra usage.
  - A `UsageNotice` appears above the composer only when a window runs low or out.
  - `/usage`, the command palette and Settings → Usage open the same panel. The
    budget is set in Settings → Usage.
  - The copy follows a battery metaphor throughout: we say what's _left_.

## Consequences

- The SDK's `/usage` control request is marked experimental. If it's renamed, Conch
  degrades to "Update Claude Code to let Conch show your usage limits" rather than
  failing.
- Spend is Claude Code's list-price estimate of what ran through Conch. It is not
  your provider bill, and the UI says so. Usage outside Conch isn't counted.
- A new engine gets usage limits by implementing `usage()`. Metered engines get spend
  tracking for free.

## Update (2026-10-04): limits follow the chat

Several providers answer at once (ADR 0012), so one gauge for the default provider
showed the wrong numbers in a chat answered by another. Now:

- `UsageService` keeps a meter per provider. Each snapshot names its `engine`;
  `GET /api/usage?engine=` reads one, and `usage.changed` says whose it is. A turn
  re-reads the provider that answered it, and every engine's live hints
  (`onLimits`) reach its own meter. Spend and the budget stay Conch-wide.
- The header's `ProviderMeter` replaces both the `UsageMeter` chip and the old
  default-provider status pill: it names the chat's provider and shows that
  provider's limits, follows the model chosen for the chat (or the new-chat
  draft), says **Sign in** when that provider needs it, and offers **Connect a
  provider** when none is connected. Its panel shows the account, the limits,
  and makes the provider the default for new chats in one press.
- The composer notice speaks for the chat's provider; Settings → Usage lists every
  connected provider's limits.
- Codex reports its ChatGPT plan's five-hour and weekly windows
  (`account/rateLimits/read`, and `account/rateLimits/updated` during a turn).
