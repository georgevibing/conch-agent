# 0070 — Lean mode: Conch for a model that reads little at once

- Status: accepted
- Date: 2026-10-04
- Builds on: [ADR 0022](./0022-a-model-on-this-computer.md) (Ollama),
  [ADR 0053](./0053-more-providers.md) (LM Studio, servers of your own),
  [ADR 0055](./0055-long-chats-on-every-model.md) (fitting the window),
  [ADR 0069](./0069-long-jobs-that-finish-and-cost-less.md) (the turn budget)

## Context

Conch's instructions and its full tool list are tens of thousands of tokens: who
the assistant is, memories, routines, skills, apps, the browser, Passwords, making
apps, and a hundred-odd tool schemas. A model on this computer reads 8K to 32K
tokens in all. ADR 0055 admitted it: in a small window the fixed part was most of
it, the floor of 1,000 tokens of chat left almost nothing, and an 8K guess for an
LM Studio model or a small server of your own was often still too big. A real
4B model on Ollama, sent everything, took 77 seconds to answer a one-line question.

Small models also have a habit: asked to remember something, they say "I'll
remember that" without calling the tool.

## Decision

### 1. Know the window

- **Ollama** (`local/service.ts` `contextFor`): Conch already read the model's own
  limit from `/api/show` and asked for 16K below 12 GB of memory, 32K above. Now it
  also reads the model's shape there (`block_count`, `attention.head_count_kv`, the
  key and value lengths: `local/ollama.ts` `kvBytesPerToken`) and asks for as much as
  fits in two fifths of the computer's memory once the model is loaded, in steps of
  8K, up to 64K — never less than before, never more than the model reads. It is the
  same number every time for a model, so Ollama never reloads between requests.
- **LM Studio** says the context a loaded model was loaded with; an unloaded one is
  assumed small. **Servers of your own** say it in their model list when they can
  (`max_model_len`, `context_length`). Anything else is learned from the first "too
  long" (ADR 0055).

### 2. Go lean by itself

A turn goes lean (`engines/api/lean.ts` `isLean`) when the window is 16K or less, or
when Conch's system prompt and tools would take more than 30% of it. Nobody sets it.

- **A short system prompt** (`leanSystem`): the words before any heading, who the
  assistant is, who the person is, what it remembers, and what it can do — each
  within a size — plus one paragraph on loading tools. The guidance for routines,
  skills, apps and the rest is left out; each tool's own description says how to use
  it, and arrives with it.
- **Tools on demand.** The model gets one tool, `find_tools`, like Claude Code's
  deferred tools: it says what it wants to do, the best five tools by name and
  description (with a few everyday synonyms, and "an address means the web") are
  loaded, and their descriptions and schemas come back in the answer. Loaded tools are
  sent from the next request on and kept in the session, up to ten, newest last.
- **Tools the message names are loaded before it's asked.** A word of a tool's own
  name in the person's message ("remember", "browser", an address) loads up to three
  at the start. That's what turned "I'll remember that" into a real `remember` call
  on a 4B model.
- **A tool called by name without loading it** simply runs, and is loaded.
- **The summariser fits.** Each summarising request now carries only as much chat as
  fits the model's window with the instructions, the summary so far and the answer
  (`context.ts` `chunkFor`), instead of a fixed 24,000 characters.

### 3. Every model gets told about the browser

Small models read "commands have no network" as "I can't browse". The capability
line now says, when the browser is there, that Conch's browser reaches the web.

## Consequences

- Verified against a real model (Qwen3 4B Instruct on Ollama, an 8K window, over
  forty tools and a long system prompt): "Please remember that my favourite tea is
  oolong" saves the memory in about a second; "What does the front page of
  example.com say?" loads the browser and answers from the page. Sent everything
  instead (a 256K window), the same model took 77 seconds to answer the same question.
- A big model is untouched: lean only ever starts below the thresholds.
- Changing the tool list mid-chat costs a provider's prompt cache from the tools on;
  lean chats are on small local models, where that cache is the model's own and
  cheap to rebuild.
- **Known limits:** the search is words, not meaning; a tool whose name and
  description share no word with how someone asks for it needs `find_tools` with
  other words. A server that hides its window is assumed big until it says "too
  long".
