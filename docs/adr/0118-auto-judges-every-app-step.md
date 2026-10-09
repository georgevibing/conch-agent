# 0118 — Auto judges every app's step by what it does, and is Conch's own on every provider

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0117](./0117-auto-asks-about-what-matters.md) (Auto asks about what
  matters), [ADR 0100](./0100-permission-modes-every-provider.md) (the ladder, Auto's risk
  policy, the second look), [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0061](./0061-apps-you-make-share-and-add.md) (Conch apps)
- Amends: ADR 0100's row for Claude Code (its own auto mode is no longer used), ADR 0117's
  "A stranger's app is unchanged" and "Apps over MCP are unchanged"

## Context

The day ADR 0117 landed, the same chat asked again. In Auto, the person read their Yazio
diary, then the assistant looked up the names of the eleven foods in it: eleven questions at
once ("Use Yazio to get product …"), two of them answered no. Then Claude Code itself refused
a read-only `grep` with "denied by the Claude Code auto mode classifier". The causes, precisely:

1. **An app the person made counted as a stranger's.** Yazio was made in a chat that had read
   the GitHub repository it was built from, so its source was stamped `afterReading`, and
   `madeHere` is false for ever after. Every rule ADR 0117 gave the person's own apps (looks go
   by themselves, its own answers don't hold it, changes judged by the risk policy) skipped it.
2. **A stranger's app asked every time after reading, in Auto too.** `hostAsk` only let a step
   through after reading when `appStep.own`; anything else went straight to the after-reading
   card, without the risk policy. And a stranger's app marks the chat with its own answers, so
   after its first answer, every next call asked.
3. **The person's Allow didn't count.** Yazio's policy was **Don't ask**; the after-reading reason
   asked anyway. The same for a connected app over MCP: after reading, every change in GitHub
   asked "act in GitHub", whatever the tool was set to.
4. **Calls made at once asked at once.** Eleven parallel lookups made eleven cards; "Always
   allow" on the first can't reach the ones already asked.
5. **Two judges in Claude Code.** Auto ran as Claude Code's own `auto` mode where the model had
   one, with Conch's risk policy in the hook. Its classifier added questions Conch's policy
   wouldn't (an `escalated` call always asked the person) and refused outright what Conch lets
   through (that `grep`). Working agreement 11 already says to judge through `risk.ts`, "never
   … an engine's own approval setting".

What the person asked for: Auto should block only what is, judged intelligently, really
risky, for apps from strangers too, not every little step.

## Decision

### The person's own apps include the ones made after reading (`ownedHere`)

`ownedHere(source)` is true for an app made in this Conch, whatever its chat had read, unless
it was changed from someone else's (`basedOn`). The guard after reading uses it
(`conchapps/hosted.ts`): the sites such an app reaches are the ones its card showed the person,
beside "Made in a chat that read …", when they pressed **Add**. The sealed runtime holds it to
exactly those sites. So its looks go by themselves, and its changes are judged as the person's
own (ADR 0117).

What stays as it was: its descriptions and notes are still fenced as someone else's words where
they reach the model (`madeHere`); it still starts at **Ask every time**; and its answers still
mark the chat, with its provenance (`Yazio (from a chat that read …)`), for every other way out.
Only its own next step isn't held by those two marks.

### Any app's step in Auto, after reading, is judged, not asked

With a person in the chat and only things read (no one else's words, no skill's list), in Auto:

1. **The rules, for every app** (`risk.ts` `assessRisk`, the one policy). Besides what ADR 0117
   reads (deleting, paying, speaking for the person, pages of text in a lookup), a step asks
   after reading when:
   - it sends something shaped like a key or token (`carriesSecrets`: private keys, `sk-`,
     `ghp_`, `github_pat_`, `xox?-`, `AKIA`, `AIza`, JWTs), or a long encoded blob (base64 of 48
     or more with mixed case and digits, or 80 or more hex). Ids, UUIDs, dates, names and notes
     don't look like either. Severe, not lasting: it asks only after reading;
   - a change grants access or reach (`GRANTS`: collaborators, roles, members, permissions,
     tokens, keys, secrets, webhooks, OAuth). Moderate and lasting;
   - it runs code it's given (`RUNS`: `execute`, `eval`, `run_code`, `run_script`, `sql`…).
     Moderate and lasting.

   None of these ask before reading. The corpus (`test/riskCorpus.ts`) has the benign shapes
   (a food by its UUID, a diary date, a Notion page id, a meeting note) and the new ways out.

2. **A second look, for someone else's app** (`risk-look.ts` `lookAtAppStep`). For a Conch app
   from outside, and for a connected app over MCP, a step the rules found nothing in:
   - a **lookup that sends no more than a lookup** (no value over 100 characters, 200 in all:
     `sendsMoreThanALookup`) goes by itself. An attacker can't carry much out in a date or an id;
   - a **lookup that sends more, and any change**, goes past a small model the person already
     has, like a command's second look (ADR 0100). It sees the app, the tool, its arguments,
     the person's own last words and what the chat read, fenced and datamarked (spotlighting),
     and answers one of a few kinds (send-out, speak, grant, spend, destroy); Conch says it in
     its own words. It can only add a question;
   - a tool the person set to **Allow** is their answer: no look, only the rules;
   - **no model, a timeout, or an answer it can't read**: the step's own question stands, as
     before ADR 0118. Failing closed keeps a person without a small model exactly as safe.
3. **The person's own apps** keep ADR 0117's rules only, no look: their sites are the person's.

Outside Auto nothing changes: Ask first, Edit freely and Plan only ask after reading as before.

### Lookups asked at once are one card

Questions from one app's lookup tool, asked at the same moment for the same reason, share one
card and its answer (`together` in `hostAsk`). Changes are never joined: what a change does is
in its arguments, and each is shown.

### Auto on Claude Code is Conch's Auto

Claude Code runs Auto as `default`, and Conch answers every question it asks
(`requestPermission`) with the same policy every other provider gets: the hook's guard, the
risk policy, the second look, the behaviour watch. Its own classifier is no longer used, so
`PermissionRequest.escalated` is gone. One judge, the same answer on every provider, and no
refusal the person can't see the reason for. Ask first, Edit freely, Plan only and Full trust
are mapped as before.

### What doesn't change

The circuit breaker, the behaviour watch (ADR 0117), protected paths, tools turned off, a
tool set to Ask (Auto keeps asking), words to other people after reading (shown each time),
spending money, someone else's words in the chat, a routine or a chat app that read something,
and a skill's list. The marks a chat carries are the same; only which steps they hold back is.

## Threat model

An attacker's words reach the chat (a page, an email, a shared food database) and try to steer
the assistant. What they'd want from an app's step, and what stops it:

- **Carry the person's data out** through a stranger's app whose site its maker reads: a key
  or blob in any argument asks (the rules); anything longer than a lookup gets the second look;
  a lookup's short values can't carry much. Without a look, it asks.
- **Act for the person** (post, invite, pay, delete, grant access, run code): the rules by
  tool name, then the look for what names don't say (`create_issue` on a public repository).
- **Talk the second look round**: its input is fenced and datamarked, its answer is a kind
  from a fixed list, and it can only add a question.
- **Make the person's own app do it**: its sites were on its card when they added it, and the
  rules still read every step.

The residual risk: a stranger's lookup sending under 200 characters to its maker's site, after
reading, goes unasked. That's a few words of the chat at most, to a site the person agreed the
app may reach. A tool set to **Ask** keeps asking for those who want more.

## Consequences

- In Auto, after reading, Yazio's lookups and diary changes go without a word, and so does a
  stranger's weather lookup; GitHub issues and Notion pages go when the second look sees
  nothing wrong; adding a collaborator, a webhook, a payment, a delete or code to run asks.
- Without a small model, someone else's apps ask after reading as they did before; the
  person's own apps don't need one.
- Claude Code in Auto no longer refuses everyday commands by itself; what it asks, Conch answers.
  The cost is a round-trip through Conch for each of its questions, as for a model that never
  had its own auto mode.
- The thresholds will need care, as ADR 0117's: a 48-character mixed-case token in a note asks
  after reading. One question with its reason.
- Stored data: nothing new. An app's `afterReading` keeps its meaning for its card and fence.

## Sources

The same sources ADR 0117 read on 2026-10-08, and the spotlighting paper the second look
already follows (`risk-look.ts`), applied here to app steps:

- [OWASP Top 10 for LLM applications 2025](https://genai.owasp.org/llm-top-10/): LLM01 prompt
  injection, LLM02 sensitive information disclosure, LLM06 excessive agency (judge each action
  by its effect; limit what goes unchecked).
- [OWASP Agentic AI threats and mitigations](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/):
  tool misuse, privilege compromise; policy checks on tool arguments before execution.
- Greshake et al. (2023), indirect prompt injection; Willison's lethal trifecta: the mark
  stays, and only the ways out that can carry data or act for the person ask.
- Hines et al. (2024), spotlighting: delimiting and datamarking untrusted input for the look.
- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes): its auto
  mode's classifier, read again for what it blocks by default and what `default` mode asks.
