# 0021 — Connect an app from the chat

- Status: accepted
- Date: 2026-09-30
- Amended by: [ADR 0049](./0049-every-app-works-with-every-model.md) (every app in the gallery is Conch's own; provider servers come in by themselves)

## Context

People ask for things in apps they haven't connected ("what's assigned to me in
Linear this week?"). The assistant then either guesses, which is worse than
nothing, or explains how to connect it on another page. Conch knows its catalog,
knows what's connected, and knows what each provider reaches by itself, so it
can offer the one step that's missing, right where the person asked.

The risk is the opposite failure: an offer for "linear algebra", "the notion of
time" or "slack in the rope" reads as an ad and teaches people to ignore the
card. A false suggestion is worse than none.

## Decision

**Cues belong to the catalog.** Every entry in `integrations/catalog.ts`
declares `cues` (server-only): phrases that only mean the app — its name
written as a name mid-sentence, or next to words that only go with it ("Linear
tickets", "Notion page", "Stripe customers") — plus its own links, and `not`
phrases blanked out first ("linear algebra"). Before reading, `cues.ts` removes
code, email addresses, file names, negations ("we don't use Linear"), and talk
about an app rather than to it (its API, its design, its news). A message that
compares apps ("Linear vs Jira") gets nothing. `cues.test.ts` holds real
requests for every entry and more realistic negatives; a new entry fails it
until it has examples.

**The gateway decides, before the turn, for every provider** (agreement 9).
`IntegrationService.suggest` offers an app only when it isn't connected in Conch
in any state (including one added by address), the provider answering doesn't
reach it itself (account connectors or its own servers; if it can't say within
2.5 s, nothing is offered), it isn't retired, and it isn't muted. An app only a
provider's account can reach goes through Zapier when this provider has no
account connectors (unless Zapier is connected already). At most two per
message, each at most once per conversation, never in an unattended run.

**It's part of the log.** `integration.suggestion` `{catalogId, name,
description, color?, via?}` is appended after the message, so it replays on
reload and on every device; "Not now" appends `integration.suggestion.dismissed`
(`POST /api/conversations/:id/suggestions/:catalogId/dismiss`). "Don't suggest"
is `preferences.mutedSuggestions`, undone on the card or in Settings → Models &
modes.

**The assistant is told, briefly.** Every turn about a cued app that isn't
connected gets a three-line section: it can't see the app, mustn't pretend or
guess, should answer what it can and say it'll help once it's connected. Only
the turn that showed the card mentions the button (so the reply doesn't explain
how to connect). Later turns, muted apps and routines still get the "can't see
it" line, so the assistant never makes something up.

**The card waits for the reply.** The web shows Nacre `IntegrationSuggestionCard`
under the reply it came with, once that reply is finished: the app's logo is the
only colour, one button. Connect opens the connect dialog in place (in a chat it
ends with Ask again, which resends the question that brought the offer up).

## Consequences

- Precision over recall: some real requests aren't offered (a lowercase "in my
  drive", an app named at the start of a sentence with no other cue). The table
  test is where to tune it.
- A cold provider (Claude Code's server list isn't cached yet) delays a matching
  turn by up to 2.5 s once; the look carries on in the background and the next
  message benefits.
- On phones the sign-in goes in the same tab and comes back to the integration's
  page, not the chat. Returning to the chat is follow-up work.
