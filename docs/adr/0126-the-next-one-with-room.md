# 0126 — At a limit, the next one with room

- Status: accepted
- Date: 2026-10-09
- Amends: [ADR 0023](./0023-offline-and-limits.md) (who carries on at a limit, and that it's
  off by default), [ADR 0005](./0005-usage-limits.md) (a key that refused counts as at its limit)

## Context

At a usage limit, Settings offered a plain list: "Wait until it resets", then "Continue with"
each provider that was ready. It was off by default, so the question waited for hours while a
plan with room sat connected. Three things read badly:

- **Codex twice.** "Continue with Codex CLI" and "Continue with Codex" are two ways into the same
  ChatGPT sign-in, with the same limits. One at its limit means both are.
- **Nothing to choose by.** The list didn't say which had room now, which costs money, or which
  model would answer.
- **One pick, or nothing.** A pick that was itself at its limit, or past the month's budget,
  left the chat at the failure card.

What each provider can say about its own room, ahead of a turn:

| Provider                                                               | What it tells                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code on a plan                                                  | Every window (the five-hour session, the week, per model) with its share used and reset time, from the SDK's `/usage` (ADR 0005); `rate_limit_event` during a turn says when it's refused and until when. |
| Claude Code on a key, Bedrock                                          | Nothing: it's metered. Conch counts the money.                                                                                                                                                            |
| Codex, Codex CLI on ChatGPT                                            | The plan's five-hour and weekly windows (`account/rateLimits/read`, `account/rateLimits/updated` during a turn). One sign-in for both.                                                                    |
| OpenRouter                                                             | What the key has spent against its own limit at OpenRouter, and the free models' daily allowance.                                                                                                         |
| The other keys (Anthropic, OpenAI, Gemini…), Copilot, Gemini CLI, Grok | Nothing ahead of time. A refusal ("429", "quota", "usage limit") is a `TurnProblem` `limit`.                                                                                                              |
| This computer                                                          | No limit, and no money.                                                                                                                                                                                   |
| Conch itself                                                           | The month's budget (ADR 0079), which holds every key. A chat's own limit holds its turns on a key.                                                                                                        |

## Decision

### Automatic, by default

`preferences.limitFallback` is `auto` (unset), `wait`, or a provider's id. **Automatic** is the
default: at the moment of a limit, `Services.route` asks `usage/fallback.ts` for every account
that could carry on and uses the first with room that can carry the chat (`carryTools`, ADR
0050), with the model it would answer with anyway. A pick by name is tried the same way, only
while it has room. When none can, the model on this computer answers if
`preferences.offlineFallback` lets it — the same switch as offline, now the last step of every
order. `wait` waits, as before.

This turns on by itself something that may spend money, which ADR 0023 avoided. It's bounded:
the person's plans come first, a key is used only within the month's budget and its own limit,
the chat's own limit still holds the turn (`#capped`), the line in the chat says so at once with
**Switch back**, and each choice says what a reply costs before it's ever used.

### The order

`fallbackChoices(from, deps, order)` reads only what's already known (the usage meters,
`Billings`, the ledger, the capabilities) and returns `FallbackChoice`s:

- **One per account.** Providers with the same `Engine.sharesAccount` (Codex and Codex CLI:
  `openai-codex`) and the same signed-in person are one choice, named by the shorter label. The
  first that can carry the chat answers. Another way into the account at its limit is never
  offered. Two accounts that would read the same ("Codex" twice, two keys) are named by whose
  they are: "Codex · ada@work.example".
- **Ranked.** The person's `preferences.limitOrder` first (any way into a choice counts for it),
  then the rest: plans before keys, keys by `perReply` (list price of `TYPICAL_REPLY`), one Conch
  can't price last. The order doesn't move with room, so what the person sees is what happens;
  room only decides which are passed over.
- **Room.** A plan's tightest window (`low` from 90% used, `none` at 100% or while `blocked`);
  a key `none` past the month's budget or its own limit (OpenRouter's `extra`). A provider that
  refused for a limit Conch couldn't see coming is `UsageService.refused`: passed over for a
  quarter of an hour, or until the time it gave. Its twins count as refused too.
- **Facts.** Each choice carries its account in words, its room and reset time, its cost per
  reply on a key, the model it answers with, and `skip` — why Automatic passes it over now.

`GET /api/fallback?engine=` returns them as a `FallbackPlan`, for the default provider unless
named, with the provider's own reset time and the model on this computer.

### In the chat

Routing is per turn, so a chat **comes back by itself**: once the limit resets, `blocked` clears
and the chat's own provider answers, handed what it missed (ADR 0069). With
`preferences.limitReturn` off, the route says `stayed`, and the chat moves to whoever carried it
on: its provider and model are that one's from then on.

`turn.routed` says it once: "Claude Code reached its limit until 18:00. Codex is answering."
(`sameRouteAsLast`: the next message to the same one at the same limit adds no line; a retry
after a failure always does, since it replaces the failure card.) It carries `fromModel` and
`stayed`.

**Switch back** on the latest such line (`POST /api/conversations/:id/limit-back`) gives the
chat back to its own provider with the model it had, and logs `limit.back { engine, until }`.
Until then (the reset Conch knew, else five hours) the route is asked with `wait`, so this chat
waits for its provider; afterwards Automatic is back. The line folds to "Back to Claude Code:
this chat waits for it until 6:00 PM." That's the per-chat override. Agents have none of their
own: an agent's defaults choose a provider, and Automatic carries it on like any other chat.

Background tasks carry on through the same route (`TaskDeps.limitFallback`). Routines still
don't (ADR 0023, ADR 0057).

### Settings

Settings → Providers → When one can't answer → **At a usage limit** is Nacre `FallbackPicker`, a
radio list best first: **Automatic: the next one with room** (Recommended), with the order in
words and who would answer now; **Wait until it resets**, with when; then each account, with
its facts ("72% left · resets 6:00 PM · Included in your plan · Answers with GPT-5.5").
Under it, while Automatic is chosen, **In this order** with arrows to move each. Then two
switches: the model on this computer, last, and **Back to Claude Code once it resets**.

## Consequences

- Someone who never chose anything now has a key carry on at a plan's limit. That's money
  they didn't spend before; the line in the chat and the budget are what keep it honest.
- Only providers whose windows Conch reads are known to be at a limit ahead of a turn. The
  rest are found out by one refused turn, and then passed over for a while.
- "About $0.02 a reply" is a typical reply at list price. A long chat costs more, and a model
  Conch can't price says only "Pay per use".
- A new provider that's another way into an account Conch already drives sets
  `sharesAccount`. One that reports its windows (`usage()`) is ranked by its room at once.

## Verification

- `usage/fallback.test.ts`: ranking (plans, then keys by price; your order first), one choice
  for Codex and Codex CLI, two accounts named, the account at its limit never offered, skipping
  one at its limit, past its key's limit or the month's budget, a refused twin, one that can't
  carry the chat.
- `app.test.ts`: `Services.route` with Automatic, your order, a refusal, your pick, staying,
  waiting, a chat that waits, and the model on this computer last; `GET /api/fallback`.
- `conversations/routing.test.ts`: switching mid-chat with the handoff, one line for several
  messages, coming back at the reset, past the first with no room, staying, Switch back.
- Nacre `FallbackPicker.test.tsx` (axe, keyboard, reorder, skipped, switches) and the web's
  `FallbackSection.test.tsx`, `OfflineBits.test.tsx`, `reducer.test.ts`.
