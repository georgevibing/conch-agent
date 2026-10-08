# 0103 — The chat tells what the assistant is doing

- Status: accepted
- Date: 2026-10-07
- Builds on: [ADR 0028](./0028-safe-hands.md) (Activity, the guard after reading),
  [ADR 0030](./0030-undo.md) (change sets and Undo),
  [ADR 0060](./0060-the-chat-knows-conch.md) (tool views, plans),
  [ADR 0088](./0088-quiet-learning.md) (the small model, its engine and its spend),
  [ADR 0025](./0025-passwords.md) (no favicons fetched from the web)

## Context

A transcript listed every tool call as it came, under its raw name. A coding turn was
screens of `Bash python3 - <<'PY'…` rows; a research turn showed the same page fetched
twice as two cards. Someone who has never opened a terminal can't read that, and it's
the first thing Conch shows them while it works. People who do read terminals still
need every call, exactly as it ran: what was typed, what came back.

What we learned from other agents and from research:

- **Counting hides the what.** Agents that fold steps into "Read 3 files" or "Used 5
  tools" drew complaints from the people they were meant to help: a count says
  nothing about which files, or what was found. Nobody we looked at folds steps into
  their _outcome_ ("Ran the tests · 241 passed").
- **Most people don't read thoughts.** A model's reasoning, streamed as it comes, is
  long and written for the model. It is also not a faithful account of why it acted
  (Turpin et al., 2023, "Language models don't always say what they think"; Anthropic,
  2025, "Reasoning models don't always say what they think"). So words about a step
  should be tied to the step's own evidence: its name, its input, its output.
- **Walls of steps tire, and so does flicker.** A row per call, each one appearing and
  changing state in place, is noise at the speed agents work. Lines that change faster
  than they can be read are worse than none.
- **Calm technology** (Weiser and Brown, 1995): the work should sit at the edge of
  attention and come to the centre only when it needs the person, or when they ask.

## Decision

### Three layers

What the assistant did is told at three depths, each one press from the next:

1. **The story line.** A run of tool calls between two pieces of the assistant's prose
   is told as one to three stories, each one line: what it did or is doing, what it came
   to, what it touched. "Ran the server tests · 241 passed".
2. **The steps in plain words.** Open a story and its steps are there on a thin
   timeline, each said in words ("Read Transcript.tsx", "Searched the web for flights
   to Lisbon"), with what it found and how long it took, and **Why?** beside it.
3. **The raw call.** Open a step and it's the exact call: input, output, diff, as before.

### Words from three sources, in order

**1. Rules, for every step and every provider.** `describeTool(name, input, result?)`
(`packages/protocol/src/activity-describe.ts`) returns a `ToolLabel`
(`packages/protocol/src/activity.ts`): a family, `doing` and `done` words, an
`outcome`, a `subject`, `failed`, `effects` and `chips`. It knows Conch's host tools, its
own apps' tools (`app-tools.ts`), each provider's built-in tools (Claude Code, Codex,
the IDE tools), the browser, and other apps' MCP tools by their verbs. A shell command
is read the way a shell splits it (`activity-describe/shell.ts`: quotes, pipes, `&&`,
heredocs), the wrappers that don't change what it does come off (`cd x &&`, `sudo`,
`npx`, environment variables), and about 80 programs are known by name: git and gh,
the package managers, test runners, type checkers, linters, builders, docker, kubectl,
curl and more. The output refines the words (`activity-describe/output.ts`): how many
tests passed, how many type or lint errors, where a push went, what a search found, and
the line that says why it failed, read from a bounded window so a long log costs no
more than a short one. Raw shell never goes in the words; the command is the subject:
`python3 - <<'PY'…` reads "Ran a Python script".

The gateway writes the label onto `tool.started` and `tool.finished` as the log is kept
(`conversations/stories/labels.ts`, after redaction), so every client and chat app reads
the same words. A chat logged before then has none, and the web works them out with the
same function (`stepFromTool`).

**2. The provider's own narration, where it has some.** An engine that can say what it
is doing for the person watching declares `Engine.narration = 'provider'` and yields
`narration` stream events (`engines/types.ts`). The manager cleans them (no markdown,
one line, at most 240 characters), drops a repeat and paces them to one every half
second (`conversations/stories/narration.ts`, `NarrationPacer`), and logs a `narration`
event with `source: 'provider'`. The chat's live line shows the newest.

- **Claude Code**: its tool-use summaries, turned on with
  `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=1` (`engines/claude-code/engine.ts`), each about
  the last call of its round (`translate.ts`). A round of only plan updates says nothing.
- **The Anthropic API**: with thinking on, the request asks for
  `thinking.display: 'updates'` under the beta `thinking-display-updates-2026-08-18`,
  which makes the thinking blocks short notes. Each line becomes narration, and the
  blocks are still replayed to the model verbatim. A model or account that refuses the
  beta is asked again without it, and isn't offered it again (`engines/api/anthropic.ts`).
- **Codex**: a plan update's `explanation` (`engines/codex/app-engine.ts`).
- **None** for the ACP programs, OpenAI-compatible APIs and models on this computer:
  their live line uses the rules' words for the step at hand.

Narration is never reasoning and never a headline. It's what the line says while the
work runs.

**3. A small model, for story headlines only.** When a story ends with enough in it and
the rules' headline says little, `StoryTitler` (`conversations/stories/titler.ts`)
asks a small model for a better one and logs `story.titled` (`StoryTitle`: `storyId`,
`headline`, `outcome`, `source: 'model'`). The chat morphs the headline in place.

- **Which stories.** Closed (no step still running), with at least three visible steps,
  or two of different kinds; and of no single kind, or of mixed kinds, or with a generic
  rules headline ("Used 4 tools", "Worked on…") (`wantsHeadline`).
- **Bounds.** Two at a time across every chat, six a turn, twelve seconds each. The same
  steps said the same way are asked once (`storyKey`, a cache of 500). Chats nobody
  watches (a page fetching its data, an app's client) get none.
- **The answer is checked** (`prompt.ts`, `readHeadline`): JSON with a headline of at
  most eight words and an outcome of at most five; dropped when it has quotes, markdown,
  emoji or dashes, speaks in the first person, refuses, or only repeats one step's words.
  A dropped answer leaves the rules' headline standing.
- **Who is asked, and what it costs**: the same rules as quiet learning (ADR 0088,
  `conversations/stories/ask.ts`). The provider that answered the chat first (it has
  read it already), else one on this computer, else any connected one. A private chat
  (marked "Don't learn from this chat", a guest's, a routine's or a task's) goes only to
  its own provider or one on this computer. Nothing is asked past the month's budget or
  learning's spend gate, and what it costs counts against learning's monthly cap.
- **The switch** is `preferences.autoTitle`, the one that names new chats.

### Stories

`tellStories(steps)` (`packages/protocol/src/activity-stories.ts`) cuts one run of tool
calls into stories. It's pure and shared, so the gateway (which titles stories) and the
chat (which draws them) always cut them the same way.

- **Cut by phase** (`activity-stories/cut.ts`, `steps.ts`): looking and changing code is
  `work`, then `verify`, `ship`, `research` (the web and the browser), `connect` (each
  app its own), `make`, `delegate`, `plan`. A quick look and a change before a check is
  one story of trying it; up to four changes right after a check belong to it. Runs of
  two are always one story, and no story grows past 30 steps.
- **Prefix-stable and status-independent.** A cut is decided one step at a time from
  the steps before it, by their names, inputs and families, never their status, because
  parallel calls finish out of order. So a story once followed by another never changes:
  only the last one grows, and the gateway can title a story as soon as it closes.
- **Noise attaches, never starts.** Checks on a running command (`process_read`,
  `BashOutput`, …) and plan updates join the story they're in and get no line of their own.
- **Repeats fold.** The same call with the same input, done again with nothing changed
  between, folds into its first (`×2`), unless it failed: trying again is worth a line.
- **Stuck, said plainly** (`activity-stories/stuck.ts`): "The same command failed 3
  times", "It keeps making the same change and undoing it", "Checked on it 5 times in 4
  minutes and nothing changed". It works on a running story, so it shows while there's
  time to step in.
- **Notes**: a failure put right later in the story says "Worked on the second try" or
  "Worked after a fix", and the story is done, not failed.
- **The rules' headline** (`activity-stories/headline.ts`): one step's own words, or
  steps of a kind counted with what they were ("Read 6 files"), or two kinds joined
  ("Searched the web and read 3 pages on amazon.de"); `-ing` while it runs, past tense
  once done, 60 characters at most. Which words lead is **consequence, then count, then
  order**, never the first step alone: sending off over changing over checking over
  looking, and within that what it changed (a push over a commit over a tag over
  staging); then the phrase covering most steps; then the earlier one. A look never
  joins a change, staging never joins what it staged for, and a story that's a check is
  told as the check, its fixes left to its note. What never ran ("Didn't run the tests")
  weighs nothing. If two phrases won't fit, the leading one stands alone. The outcome
  comes from what the headline names: a check it names (the tests first), else the
  push (or what the commit said), the lines its changes came to, or the leading step's.
- **A run is one step.** A command started in the background and checked on until a
  check saw it end reads as the run: "Ran the tests · 241 passed", lasting until then.
- **What never ran.** A call you said no to, that a rule stopped or nobody answered is
  worded by the rules from its answer (`ToolResult.approval`): "Didn't run the tests",
  "Didn't send an email", no effects, not a failure.
- **Effects merged**: a file touched many times counts once ("Edited 3 files").

### What changed, what you missed, why

- **What changed.** At the end of a turn, `groupEffects` (`activity-stories/effects.ts`)
  merges what the steps changed outside the chat into one line ("Changed 4 files ·
  committed · pushed to main") that opens to each change, the consequential first: what
  other people see (a message sent), money, what's gone, what left this computer, then
  what stays here. A change with a change set (ADR 0030) offers **Undo**, then **Redo**.
- **While you were away.** Coming back to a chat that kept working with its tab hidden,
  a card says what happened, a line per story, each one a jump to it.
- **Why?** on any step: `POST /api/conversations/:id/explain` (`conversations/stories/routes.ts`,
  `explain.ts`) gives a small model the person's request, what the assistant said just
  before, and the call with what it found, and returns one to three sentences. Same
  engine, privacy and spend rules as headlines; six a minute per chat; a finished step's
  answer is kept, so asking again costs nothing. With no one to ask, it says why
  ("This month's budget is spent…"). It only reads the log; no tool reaches it.
- **The turn's tally.** How long, how many steps, what it cost, what it wrote.

### Site icons, through Conch

A story's chips show the sites it touched with their icons. A third-party favicon
service would learn every site the assistant visits, so the gateway asks each site for
its own (`GET /api/favicon?host=`, `apps/server/src/favicons/`): `favicon.ico`, then the
icons the home page names. It goes through the public-web reader `web_fetch` uses
(`createFetcher`): https only, every address checked as it's dialled, every redirect
checked again, no cookies. Only raster images, by declared type and first bytes, at most
100 KB; SVG is refused (it can carry script) and a monogram stands in. Icons are kept a
day, misses an hour, and fresh lookups are budgeted. Passwords keeps its rule: a login
wears a monogram, never a fetched icon, because asking would tell the site you have an
account there.

### Model-written words are plain text

Headlines, outcomes, narration and Why? answers come from a model that read untrusted
output (a page, a file, a command's output). The prompts fence that material as data,
the checks strip markup, and the chat draws the words only as plain text: never
Markdown, never a link, never something to follow.

### In Nacre

`Story`, `StoryStack`, `LiveLine`, `WhatChanged`, `AwayDigest` and `TurnMeter`
(`packages/nacre/src/patterns/*`). Thirteen family glyphs (`FamilyGlyph`), each with one
part that moves while its work runs: the lens scans, the pen writes, the cursor blinks,
the globe turns. A headline that changes (`-ing` to past, the rules' words to a model's)
morphs in place (`MorphText`); the live line coalesces changes faster than the eye
reads. Reduced motion stills all of it. See [NACRE.md](../design/NACRE.md#stories-what-the-assistant-did-chat).

## Consequences

- People read what happened; the exact calls are still one press away, for every provider.
- Turns on the Anthropic API with thinking on show narration instead of the thinking
  text, where the model takes the beta.
- `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES` is undocumented (found in the CLI's source). If
  a release drops it, Claude Code turns get the rules' words, like any provider without
  narration.
- Headlines and Why? share learning's monthly cap: a month of many headlines leaves less
  for learning, and the reverse.
- ACP providers and OpenAI-compatible APIs get the rules' words only.
- Old logs have no labels; the chat works them out on the client with the same rules,
  so they read like new ones.
- A new tool, or a program people run often, needs its words in `describeTool`, or it
  reads as little more than its name ("Used lookup order").
