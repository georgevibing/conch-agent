# 0060 — The chat knows Conch

- Status: accepted
- Date: 2026-10-03
- Amends: [ADR 0021](./0021-connect-from-chat.md) (offers become one kind of card, and the chat carries on by itself), [ADR 0013](./0013-skills.md) (the assistant can offer a skill that's off)

## Context

Conch has many parts: apps, skills, routines, background tasks, the browser,
pages it can show. The chat used only a few of them, and only when it was told
to by name. Three gaps cost people the most effort:

1. **The assistant didn't know what Conch could do.** It saw the apps already
   connected and the skills set to **Automatically**, nothing else. An offer to
   connect an app came only when the person's words named it ("Linear tickets").
   "What's on my plate this week?" got a guess, or an explanation of where
   Apps is.
2. **Taking an offer meant starting over.** You connected the app, then pressed
   **Ask again**, or typed the question again.
3. **The chat could only answer in prose.** It asked questions as paragraphs
   with numbered options and you typed the answer. Its plan was a tool row
   that said "Updated the plan". A day's calendar arrived as a bulleted list.
   Every reply ended and left you to think of what to say next.

The Conch promise is the least effort for the person. The chat is where they
spend that effort, so it's where Conch should show what it can do.

## Decision

Six parts, one rule each. Every part works with every provider that can use
Conch's tools, and degrades on purpose for one that can't (agreement 9).

### 1. The assistant gets a map of what Conch can turn on

Each turn's system text gets a short section, **What Conch can turn on**
(`offers/map.ts`), next to the existing `## Apps` section. It lists:

- **Apps in the catalog that aren't connected.** Name and tagline, one line
  each. Retired and muted apps are left out, and so are apps the answering
  provider already reaches by itself.
- **Skills that are Off or set to When I ask.** Name and the first sentence of
  the description.

The section has a budget of 2,400 characters. Past it, apps the person is least
likely to want are dropped first (not `featured`, then alphabetical), and the
section says how many were left out. It ends with plain rules. Call `offer`
when one of these would clearly do what was asked, and only then. Never offer
what the person said they don't use. Answer what you can first. Don't explain
how to set anything up, because the card does that.

### 2. `offer`: the assistant proposes, the person turns it on

The host tool `offer({kind, target, why})` (`offers/tools.ts`) lets the
assistant propose one app or skill from the map. It never turns anything on.
The server checks every proposal in `OfferDesk` (`offers/desk.ts`), which is
also the one place cue offers go through (ADR 0021's `suggest`). An offer is
dropped when:

- the target isn't in the map: unknown, already connected, retired, or the
  provider reaches it itself;
- the person muted it (`preferences.mutedSuggestions`; skills use `skill:<id>`);
- it was already offered in this chat, whether or not it was put away;
- one offer has already been shown this turn (cue and assistant together), so
  there's never a pile of cards;
- the turn read something untrusted (ADR 0028), but only for the assistant's
  offers, because a page must not be able to ask for an app to be connected;
- nobody is there: routines, background tasks and chats that came in from a
  chat app.

The tool answers in words the model can act on. Either "A card to connect
Google Calendar is under your reply. Answer what you can now; when it's
connected you'll be asked to carry on", or why nothing was shown.

The `offer` event carries `Offer` (`@conch/protocol` `chat-cards.ts`). Cue
offers now log `offer` with `by: 'cue'`. Old logs still hold
`integration.suggestion`, and the web draws those with the same card.

### 3. Taking an offer carries the chat on

`resume.request` is the request that brought the offer up: the person's last
message, as typed. When the person takes the offer, the client calls
`POST /api/conversations/:id/offers/:offerId/accept`. They take it by
connecting the app (the connect dialog reports success), by turning the skill
on, or by pressing **Use it** for a When I ask skill. The server then:

1. checks the app is connected, or the skill is on, now;
2. logs `offer.resolved {outcome: 'accepted'}`;
3. starts a new turn (`ConversationManager.carryOn`) whose prompt says the app
   or skill is now available and repeats the request.

There is no new user message: the chat shows a quiet line, **Connected Google
Calendar · carrying on**, then the answer. The request runs once, however many
devices or retries press it. The chat waits its turn if a reply is already
running.

On a phone, signing in leaves the page. The OAuth callback carries a `returnTo`
of the chat and the offer id, so the chat opens again and accepts by itself.
That fixes ADR 0021's follow-up.

**Not now** logs `offer.resolved {outcome: 'dismissed'}`. **Don't suggest**
mutes it everywhere, as before. A newer message makes an unanswered offer
`expired`. It folds to a small line and the chat never carries on from it.

**A skill offer shows what the skill may do before it's turned on.** The card
expands to the skill's permissions (ADR 0031's words) with **Turn on**. When I
ask skills offer **Use it**, which runs the request with the skill once, and
**Always** (set to Automatically).

### 4. `ask`: questions answered with a tap

The host tool `ask({title?, fields})` (`questions/tools.ts`) shows a
`Question`, and the reply waits for the answer. Field kinds:

| Kind                       | Control                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `choice`                   | Options, one or several, with **Something else…** when `other` is set |
| `date`, `time`, `datetime` | Pickers, with a suggested value                                       |
| `text`                     | A line, or a few lines                                                |
| `number`                   | A number, with a unit                                                 |

There are four fields at most. The chat's status is `awaiting-permission`,
which already means "waiting for you" to the sidebar, notifications and tasks.

The answer comes by `POST /api/conversations/:id/questions/:questionId/answer`.
It's logged as `question.answered`, and the tool returns the answer's `text`.
Anything typed in the composer while a question waits answers it as free text,
so the person never has to find the card. **Skip** answers `null`, and the
assistant is told to carry on with its best judgement and say what it assumed.

Stopping the reply also answers `null`. So does a restart: the pending answer
is lost with the turn, and the log says it was skipped. Unattended runs get no
`ask`: the tool tells the model nobody is there and to pick the sensible
default.

The prompt says when to ask: only when the answer changes what happens next,
never to confirm what was clear, and never as a numbered list in prose.

### 5. Replies to send next

Under the latest reply, up to three chips hold what the person might well say
next. Tapping one sends it. The words on the chip are exactly the words sent
(`ReplySuggestion.text`, at most 120 characters), so nothing hides behind a
label.

The chips come from two places:

- **The assistant**, through `suggest_replies({replies})` (`replies/tools.ts`),
  called last if at all. The prompt says to offer only next steps that are
  concrete and likely, and never filler like "Tell me more".
- **Conch itself** (`replies/conch.ts`), from what the reply contains. A
  Markdown table of numbers gets "Show it as a chart". A rule that needs
  Conch's tools to answer (a chart is an artifact) isn't offered to a model
  that can only chat.

A habit chip ("Do this every …", from the habit finder of ADR 0032) is left
out for now. The habit finder reads every chat in a batch, and it knows that a
request repeats, not how often it should run, so the chip couldn't say "every"
what. It joins the rules when a turn can know both cheaply.

A chat that has read something untrusted gets only Conch's own chips. Chips go
away as soon as anything newer is in the chat. They never appear in unattended
runs, after a turn that didn't finish, or while something else in the turn
waits for the person (a question, an approval, an offer): one thing asks for
attention at a time.

### 6. The plan, ticking itself off

Some engines keep a plan of their own: Claude Code's `TodoWrite`, Codex's plan
updates. Their engine translates it into a generic `plan` stream event, and the
chat logs `plan {steps}`. An engine without a plan of its own declares so, and
gets the host tool `update_plan({steps})` (`plans/tools.ts`) instead. Either
way the web draws one **PlanChecklist** per turn, updated in place. It shows
done, active (with a gentle pulse) and pending steps, and folds to "5 of 5
done" when the turn ends. In plan mode, the plan to approve is drawn the same
way, with **Start** and **Keep planning**.

### 7. What a tool found, drawn as it is

`HostToolResult.view` and `tool.finished.view` carry a `ToolView`: `agenda`,
`mail`, `files` or `messages`. The assistant still gets the text. Conch's own
tools fill it in: Google Calendar's briefing, Gmail search, Drive search, and
Slack's channel read and search. The web draws it under the tool row, open by
default, with the Nacre `AgendaView`, `MailList`, `FileList` and
`ChatMessages`. Each row is plain text from outside, and links are `https?`
only and open in a new tab.

Rows can offer next steps as composer text, never as actions: **Reply** puts
"Draft a reply to Ada about “Budget”" in the composer. Apps connected by
address (MCP) have no view yet. Their results stay text.

Artifact cards preview a chart, table, Mermaid or SVG artifact inline, small,
so the dock is for working on it, not for seeing it.

## Provider by provider

| The provider…                                                        | Gets                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Uses Conch's tools (Claude Code, Codex, ACP, API engines with tools) | Everything                                                                                                      |
| Has its own plan (Claude Code, Codex)                                | Its plan drawn; no `update_plan`                                                                                |
| Can only chat (`hostTools === false`, ADR 0050)                      | Cue offers, Conch's own chips. No `offer`, `ask`, `suggest_replies` or plan, and no map (it couldn't act on it) |

The mock engine scripts each journey (offer, carry on, ask, replies, plan,
views) so `e2e` covers them without a real model.

## Safety

- Nothing in this ADR lets the assistant turn anything on, send anything or
  spend anything. Offers, questions and chips are things the person presses.
- The assistant's words on cards (`why`, labels, options, chips) are plain
  text and length-capped. On tainted turns, assistant offers and chips aren't
  shown at all. A question still is, because its answer comes from the person.
- Tool views carry outside data. They're drawn as text, and links are checked
  on both sides (`WebUrl`).
- Carrying on repeats the person's own words, never the assistant's. It runs
  only after the server sees the app connected or the skill on.

## Consequences

- One coordinator (`OfferDesk`) decides every offer. A new kind of thing to
  turn on (a channel, the model on this computer) is a new `OfferKind`, a line
  in the map and a branch in the card.
- The `## Not connected yet` section (ADR 0021) stays for cue matches. The map
  doesn't replace it; it's what lets the assistant offer apps nobody named.
- The map costs up to 2,400 characters a turn on providers with tools. The
  budget and the order of what's dropped are tested. Apps the person's latest
  message names are listed first, so the budget never cuts the one they asked
  about.
- `offer` is loaded up front (`alwaysLoad`), because the map names it and
  Claude Code otherwise defers tools until searched for.
- Claude Code gets all of Conch's tools from one MCP server, so one tool whose
  input can't be listed (a `z.record`) takes them all away.
  `engines/claude-code/conch-tools.test.ts` lists every tool the way Claude
  Code does. Use `z.looseObject({})` for open objects.
- New Nacre patterns: `OfferCard`, `QuestionCard`, `ReplyChips`,
  `PlanChecklist`, `AgendaView`, `MailList`, `FileList`, `ChatMessages`. Each
  has stories and axe tests like every other pattern.
- `AGENTS.md` working agreement 14 makes this the default: a new thing to turn
  on joins the map, and a new tool whose results a person would rather see
  returns a view.
