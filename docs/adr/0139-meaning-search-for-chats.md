# 0139 — Searching chats by meaning

- Status: accepted
- Date: 2026-10-19
- Builds on: [ADR 0007](./0007-search.md) (search), [ADR 0041](./0041-meaning-out-of-the-box.md)
  (Conch's own meaning model), [ADR 0059](./0059-looking-through-earlier-chats.md)
  (looking through earlier chats), [ADR 0094](./0094-staying-responsive.md) (staying responsive)

## Context

Chat search matches spelling (ADR 0007). ADR 0059 named the limit: "Our
honeymoon" won't find "the trip to Bali" unless one of those words was said.
Memory search already understands meaning, with Ollama's embedding model or
Conch's own small one (ADR 0041). Chats are much bigger than memories: years
of messages, where memories are a few hundred lines.

## Decision

### 1. The same model, its own vectors

`search/meaning.ts` (`ChatMeaning`) embeds the messages the keyword index
keeps, with the same `meaning()` as memory: Ollama's model when there is one,
else Conch's own once it's downloaded, through the same download, heal and
crash paths. Nothing new is installed or downloaded for it.

- **What's embedded.** Your words and the answers. Steps (commands, files)
  are left to words. A message under twelve characters ("ok", "thanks") is
  skipped. A long one is up to four pieces of about a thousand characters, cut
  between paragraphs or sentences, since a small model reads only the start
  of a long text.
- **Where.** `chats-meaning.db`, owner-only like `search.db`: per message
  piece its vector (unit length, stored as bytes: a quarter of the size, and
  closeness barely moves), the model that made it, and a hash of the text; per
  chat, the model and what the keyword index last saw of it when every message
  had its vectors. A separate file from `search.db`, so a keyword rebuild (cheap)
  never throws away vectors (costly). Vectors from another model are dropped,
  never compared.

### 2. In the background, gently, resumable

- After the keyword index catches up at start, and after each turn (a
  two-second settle, one look per burst), the chats not marked done are
  embedded, newest first. A chat that just changed goes before the backfill's
  next.
- A batch is at most sixteen pieces, whole messages only. After each, it rests
  as long as the batch took, so it uses at most about half of one process (the
  model runs in its own process already, ADR 0041). Before each, it waits while
  `GatewayRecovery.room()` says there's no room: the same admission as every
  other background job, never a second sampler.
- Each batch is kept as it's made, and a chat is marked done only when all of
  it is. A restart, a sleep or a model that stops answering carries on where it
  stopped; a message is never embedded twice.
- With no model, nothing happens: keyword search is unchanged, and the vectors
  are made when the model lands (`Services.meaningLanded`, or Repair of the
  model).

### 3. Blended like memory

`SearchService.search` asks the keyword index as before, then meaning (only
for a search of every chat, not finding in one chat, and not for a too-short
query), and blends them the way memory search does: half each. A keyword
result's share is its place in the keyword ranking (1, then a little less for
each after); a meaning result's is its closeness, counted only above its
model's `floor`. So a chat found both ways comes first, and the words' best
result stays above anything found by meaning alone. A chat found only by
meaning brings its matching lines as hits marked `byMeaning`, with no
highlights; a line no longer in the keyword index is never shown. When the
model doesn't answer within a second and a half, the search answers by words.

Both ⌘K and `search_chats` get the blend, since both ask `SearchService`.
`search_chats` marks a chat found only by meaning `byMeaning`, answers
`match: 'meaning'` when every chat was, and tells the model to check the chat
is what the person meant.

### 4. Every rule of ADR 0059 holds

Meaning results come back through the same `pastChatTools`: not offered where
someone else writes (a `person` taint) or in routines and tasks; the chat
asking is left out; a line from a chat that read something from outside
taints the chat asking, by name; every line passes Passwords' redactor and
`scrubSecrets`; the same budgets. Embedding is done on this computer only:
the text goes to the same local model as memory's, never a provider.
`past.test.ts` tests these rules for results found by meaning.

Like `search.db`, the file isn't among the agent's protected paths: it holds
no text, and a vector only points at a message the keyword index has, whose
words are read from there. Tampering with it can reorder what the person's own
chats say, never add words to them.

### 5. Whole Conch

- **Deleting a chat** removes its vectors at once (`conversation.deleted`);
  chats deleted while Conch was off lose theirs on the next catch-up.
- **Backups**: `chats-meaning.db*` is `derived` (rebuilt from the chats), so
  it's never backed up; a restore of chats removes it with `search.db`.
- **Repair everything**: Search gains a **Search by meaning** line. A file
  that fails `PRAGMA quick_check`, or broke twice, is a warning; Repair throws
  the vectors away and makes them again in the background. A backfill under
  way is news ("12 chats aren't searchable by meaning yet"), never a problem.
  Nothing is said while there's no model: memory's check offers it.
- **Self-heal**: a file that won't open, or reads as damaged, is made again
  once per run by itself, noted under **Fixed on its own** ("Rebuilt chat
  search by meaning"); after that it waits for Repair, and search goes on by
  words.

## Consequences

- "Our honeymoon" finds "the trip to Bali", in ⌘K and for the assistant, with
  every provider, once the meaning model is here.
- A first backfill of a long history takes a while: at most half of one
  process, paused whenever the computer is busy. Searches meanwhile blend what
  has vectors.
- Vectors are held in memory for searching (about 400 bytes a piece for
  MiniLM: 20 MB for fifty thousand pieces), loaded on the first search and let
  go after ten idle minutes. Searching compares every vector; that stays fast
  enough into the hundreds of thousands, and an approximate index can come
  later if it doesn't.
- **Known limits:** a too-short query, or a search within one chat, is by words
  only. What the model doesn't know (rare names, some languages for the
  English model) it can't find by meaning; words still can.
