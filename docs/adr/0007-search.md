# 0007 — Search

- Status: accepted
- Date: 2026-09-29

## Context

People need to find a conversation — or a single line in one — from months of
history, typing a fragment they half remember, possibly misspelt. It has to feel
instant with ten chats or ten thousand, and it must work the same everywhere Conch
runs (no services to install).

## Decision

**Across conversations: an on-disk full-text index in the gateway.**

- `~/.conch/search.db`, SQLite via Node's built-in `node:sqlite` (Node ≥ 24 already
  required — no new dependency, no native build). One row per user message,
  assistant reply (markdown flattened to what the reader sees) and tool call, plus an
  external-content **FTS5** table with the **trigram** tokenizer
  (`remove_diacritics 1`): substring matching ("deplo" finds "redeployed") in any
  language, case- and accent-insensitive.
- The index is **derived data**. It's kept current from the conversation event
  stream (on each user message, turn end, title change, delete; writes only
  documents touched since the last index), catches up on start-up for conversations
  whose `updatedAt` changed, and is rebuilt from the JSONL logs if missing or from an
  older `SCHEMA_VERSION`. If it can't be opened, Conch runs without search.
- Ranking: bm25 × whole-word / phrase boosts × recency × role (your own words weigh
  a little more), grouped per conversation. Multi-word queries also match
  conversations where the words are spread across messages. **Broad queries** (more
  than 2,000 matches) take the newest matches instead of ranking all of them, so
  latency stays flat as history grows (~1 ms for the lookup). When nothing matches
  exactly, a **trigram vote** finds close matches (typos) and the UI says so.
- `GET /api/search?q=&in=&limit=` returns ranked groups with ready-made snippets and
  highlight ranges; `GET /api/search/preview` returns the hit with its neighbours.
  Folding, query parsing and excerpting are shared from `@conch/protocol` so both
  ends agree on what matches.

**Chat titles: fuzzy, in the browser.** The conversation list is already loaded; an
fzf-style scorer (word starts, acronyms like "pmw" → "Plan my week") runs per
keystroke in well under a millisecond for thousands of titles.

**Within a conversation: find-in-page on the rendered transcript.** Nacre's
`useFind` walks the transcript's text nodes and paints matches with the **CSS
Custom Highlight API** — no DOM mutation, so it stays cheap while replies stream —
re-scanning (throttled) when the transcript changes. A search result opens the chat
with find pre-filled and lands on the exact message (`data-anchor`), with a brief
flash and a match rail along the scrollbar.

## Consequences

- Measured on 48k indexed messages: rare terms ~2 ms, very common terms ~14 ms,
  typo fallback ~22 ms server-side.
- Trigrams need three characters; shorter queries match titles only ("Keep typing
  to search messages").
- The index roughly doubles the on-disk size of conversation text. Deleting
  `search.db` is always safe.
- Find-in-chat only sees what's rendered (collapsed tool output and thinking aren't
  searched); cross-conversation search covers message text and tool calls.
