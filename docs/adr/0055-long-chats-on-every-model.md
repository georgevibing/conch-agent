# 0055 — Long chats on every model: summarise the start, learn it first, heal "too long"

- Status: accepted
- Date: 2026-10-03
- Builds on: [ADR 0012](./0012-every-provider-at-once.md) (a chat moves between
  providers), [ADR 0022](./0022-a-model-on-this-computer.md) (Ollama),
  [ADR 0023](./0023-offline-and-limits.md) (`TurnProblem`), [ADR 0032](./0032-it-learns-you.md)
  (the tidy-up, memories that wait), [ADR 0053](./0053-more-providers.md) (one
  OpenAI-style adapter, a row per company)

## Context

Claude Code and Codex keep a chat themselves and compact it when it grows. The
ACP programs (Copilot, Gemini CLI, Grok) are handed a fresh, bounded handoff every
turn and compact inside a turn by themselves. A model API keeps nothing: Conch sends
the whole transcript every turn (`engines/api/session.ts`), and it was cut to a
fixed size whatever the model — 400,000 characters, 40 turns, 600 messages — by
dropping the oldest turns.

That was wrong at both ends:

- **Small windows broke quietly.** Ollama runs a model with a 16K or 32K window
  (`local/service.ts` `contextFor`). With the system prompt, memories and the tool
  list, a long chat passed it early, and Ollama silently cut the front, often the
  system prompt itself. A small API model refused with a context error, which only
  OpenRouter's adapter recognised, and the chat showed a bare failure.
- **What was dropped was gone.** No summary, and nothing learned before the cut.
  The person kept their scrollback; the model forgot what was agreed forty turns
  ago, and nobody knew.

Others compact with settings: OpenClaw summarises old turns into about 20K tokens
of recent history, flushes memory first, and offers `/compact [focus]`; Hermes
compresses at half the window and keeps the last 20 messages. Both have knobs.

## Decision

The engine that keeps the transcript fits it into the model's window, summarises
what it folds, learns what the person said there first, and heals a "too long"
refusal by itself. No settings.

### 1. A budget from the model, not a constant

`engines/api/context.ts` is the arithmetic, with no I/O:

- **The window** comes from the provider's own list: OpenAI-style `context_length`
  and its cousins (`openai.ts` `readFacts`), OpenRouter `context_length`,
  Anthropic `max_input_tokens`, LM Studio's loaded instance (the window it was
  loaded with, not what it could read), and for Ollama the window Conch asks it
  for (`contextFor`). It travels as `ModelInfo.context`. Unknown: 128K for a model
  API, 8K for a server on this computer. A window the provider names in a refusal
  ("maximum context length is 8192 tokens") is remembered for that model and wins
  when it's smaller.
- **The count is an estimate**: about four ASCII characters a token, one for other
  scripts, a fixed 1,600 for a picture where a provider puts its bytes. No
  tokenizer dependency (working agreement 3): Conch talks to a dozen providers'
  models, and no one tokenizer is right for them. Instead, each request's real
  `usage.inputTokens` corrects the estimate for that chat (`factor`), only ever
  upward, because Ollama counts only what it didn't cache.
- **The budget** is 90% of the window, less room for the answer (15%, between 1K
  and 16K tokens), the real system prompt and the real tool list, and never more
  than 100K tokens of transcript, whatever the window: every token is sent, and
  paid for, every turn.

### 2. Fold in steps, keep the prefix

Over budget (or past 600 messages, or 8 MB on disk), whole turns go from the front
until what's kept fits **half** the budget. So a compaction is rare, and between
two of them the request starts with the same bytes every turn, and providers'
prompt caches keep working. The turn being answered always stays; a single turn
bigger than everything has its longest texts shortened, head and tail kept, the
middle marked (tool results and what was sent; never the model's own messages).

The summary rides **in front of the first kept user message** at request time,
framed as `<earlier-in-this-chat>`, context and not instructions. Not in the
system prompt: a summary carries what tools returned, and must not gain a system
prompt's authority (Greshake et al., 2023). Not as a message of its own: some
servers' chat templates refuse two user turns in a row. The provider's own
messages are never edited (thinking signatures, `redacted_thinking`): the first
user message is Conch's.

### 3. Summarise with the cheapest model, fold the old summary in

The provider's cheapest model (`cheapestModel`, then `smallModel`) writes it, then
the chat's own model if that fails. A model on this computer only ever uses the
chat's own model, already in memory: loading a second one would evict it. The
folded turns are read back as plain lines ("Person:", "Assistant:", "Tool
result:", pictures named, thinking left out), in pieces of 24,000 characters a
small model can read, each folded into the summary so far. The prompt asks for
what the person wants, what was decided or done, facts to keep (names, numbers,
files, links), and what's still open, never a secret. A reply that isn't a summary
(a refusal, a tool call, nothing) is not kept.

When no model gives one, the turns are dropped as before and the old summary
stays. The chat carries on: a summary is a help, never a gate. Summarising is
counted in the turn's usage.

The transcript file (`api-sessions/<id>.json`, still version 1) gains `summary`,
`seqs` (each kept turn's place in the chat's log) and `factor`. A version before
reads the file without them, as it always did, and drops them when it writes: a
rollback loses only the summary, which is the old behaviour.

### 4. Learn before forgetting

The engine says where the model's word-for-word memory now starts (`compacted`,
with the log position of the first kept turn), and the conversation learns what
the person said before it: `MemoryTidy.learn`, by the tidy-up's rules (ADR 0032):
only the person's own words, never a routine's run or a chat with someone else
in it on a chat app, and anything learned in a chat that read something untrusted
(or with **Remember things automatically** off) waits for an OK. It's a run with
cards and Undo like any other, marked with the chat. It runs alongside the turn:
the words are still in the chat's log, so nothing is lost if it's slow.

It never double-saves: words the last tidy-up already read (`readUntil`) are
skipped, and what it learns from a chat is recorded by time (`learned`), so
neither the next fold nor the nightly tidy-up reads them again. Without a model,
or with an answer it can't read, nothing is marked read and the nightly still has
them.

### 5. Heal "too long"

Every adapter recognises "too long" in its provider's words (`tooLong`, tested
against OpenAI, Anthropic, Google, Mistral, DeepSeek, xAI, Groq, Together, vLLM,
llama.cpp, LM Studio, OpenRouter, Ollama and Zhipu bodies) and reads the window it
names (`windowIn`). Before a word of the answer arrives, the engine folds
everything but the turn being answered, shortens that turn harder, and sends it
again, once, quietly (working agreement 11); Settings → Health notes it. Only if
that fails too is it a `TurnProblem` of its own, `too-long`, whose card offers one
next step: the ready model that reads clearly more (from `ModelInfo.context`),
else a new chat with the message in its box.

### 6. What the person sees

One quiet line where the model's memory starts: **Earlier messages are summarised
for** the model's name (Nacre `SummaryDivider`). It opens to the summary, so what
the model knows is never hidden. Only the latest one shows. Every message stays.
`/compact [what to keep]` folds all but the newest turn now; on a provider with its
own `/compact` (Claude Code) it's handed over. ⌘K finds **Summarise the start of
this chat**.

### 7. Behind the engine

`Engine.context` (`compact`) and the `compacted` event are the capability: an engine
that keeps the transcript declares it. The conversation never asks which engine it
is. The mock engine declares it too, scripted, so the line and `/compact` have a
second path in tests and `pnpm dev:mock`. `TurnInput.seq` tells an engine where
each turn sits in the chat's log.

## Consequences

- A long chat works on a 16K local model and a 1M-token API alike, with no
  setting, and a refusal for length heals before anyone sees it.
- What the model forgets is written down twice: a summary it reads, and memories
  the person can read, keep or undo.
- A summary is only as good as the cheapest model, which is why the line opens to
  show it.
- **Known limits:**
  - Conch's own system prompt and tool list can be most of a very small window (4K
    to 8K). Lean mode ([ADR 0070](./0070-lean-mode-for-small-models.md)) now sends a
    short prompt and loads tools on demand there, and the summariser's requests are
    sized to the window.
  - The ACP programs get Conch's handoff each turn, which keeps the newest 60,000
    characters. When it leaves lines out it now carries the chat's latest summary
    if there is one, but Conch doesn't summarise for them on its own.
  - Estimates, not counts: a script or a code base unlike English can be off until
    the first real count corrects it, and the 10% margin and the healing cover the
    rest.
