# 0023 — Offline and at a limit: answer, or wait

- Status: accepted
- Date: 2026-09-30

## Context

Two moments made Conch feel broken although nothing was wrong with it:

- **The internet went.** A message sent on a train failed with a provider
  error, and was gone unless you noticed and pressed Try again later.
- **A usage limit was reached.** Claude said "limit reached until 15:00", and
  the question waited three hours although another provider was connected and
  ready.

Both have a right answer that needs no decision in the moment: a message sent
offline should wait and go by itself, or be answered by a model on this
computer; at a limit, a provider you chose beforehand should carry on.

## Decision

**Every turn asks who answers.** `ConversationManager` takes a `route(engine,
{ failed? })` dependency, implemented by `Services.route`. It returns one of:

| Route                         | When                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `use` the chat's own provider | Usually.                                                                                 |
| `use` another, with `routed`  | Offline and a local engine is ready (and allowed); or at a limit and your pick is ready. |
| `hold`                        | Offline, and nothing on this computer answers.                                           |

It's asked **before** a turn, and **once more after a turn fails** with
`limit` or `unavailable` — the failed provider is the moment to look again, so
a limit reached mid-chat, or a connection that dropped mid-turn, still gets
its answer without retyping.

**Offline is noticed, not guessed.** `NetworkWatch` sends `HEAD` requests to a
connectivity endpoint and the providers' own hosts, and counts as offline only
when none answers (any HTTP status means online — one service down isn't the
internet down). It looks every 5 minutes while online, every 10 seconds while
offline, and at once when a provider reports `unavailable`. Changes are
broadcast (`network.status`) and in `AppState.network`. Mock mode never
probes; tests pretend with `POST /api/mock/network`.

**A held message is part of the chat.** `turn.held` goes in the log, so a
message waiting before a restart is found again (`heldFromLog`). Messages sent
while one waits join it and go as one turn, like two texts in a row — the
provider gets them together, and the hand-over doesn't repeat them. When the
internet is back, everything waiting goes by itself, in order, and Conch
leaves a heal note. `POST /api/conversations/:id/release { engine? }` sends one
now (the "Answer now with <local model>" button).

**Another provider answering says so, once.** `turn.routed { from, to,
reason, message }` is one quiet line in the chat ("Claude Code reached its
limit until 15:00, so OpenRouter answered."). It replaces the failure card
that led there; a waiting card turns into "Sent when you were back online".

**You choose beforehand, never in the moment.** Settings → Models → "When a
provider can't answer":

- `preferences.limitFallback` — who carries on at a limit. Off by default:
  switching providers silently spends money elsewhere, so it's opt-in. `null`
  clears it.
- `preferences.offlineFallback` — let the model on this computer answer while
  offline. On by default: it's free and private, and it only applies when a
  local engine is installed and ready.

**"Local" is a property of an engine.** `Engine.local` (and `Provider.local`,
`ProviderModels.local`) marks a provider that runs on this computer. Routing
never needs to know which one it is.

## Consequences

- A new provider that runs on this computer sets `local = true` on its engine
  and nothing else: offline routing, the waiting card's button and the
  composer's offline line pick it up.
- A new failure kind that another provider could answer (not one the person
  must fix, like `signed-out`) belongs in `#answer`'s retry condition and in
  `Services.route`.
- Routines still run their turn directly (ADR 0006): an unattended run at a
  limit or offline fails and says so, rather than quietly spending on another
  provider.
- Only the default provider's usage is known ahead of a turn (`usage.blocked`);
  other providers' limits are learned when a turn fails with `limit`.
