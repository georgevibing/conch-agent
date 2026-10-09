# 0003 — Memory

- Status: accepted
- Date: 2026-09-29

## Context

A personal agent is only as good as what it remembers about you, but memory is also
the most privacy-sensitive thing it does. Popular approaches range from opaque vector
databases to "summarise everything" pipelines. We want something users can trust.

## Decision

**Transparent, local, file-based memory with agent-assisted writes.**

- **Storage.** One Markdown file per memory in `~/.conch/memory/`, with a tiny
  frontmatter (`id`, `kind`, `source`, timestamps). Human-readable, editable in any
  editor, easy to back up, trivially deletable. No network, no database.
- **Three layers**, mirroring how people think about "what you know about me":
  1. **Profile** (`settings.json → profile`): name and a short "about me". Always in
     context.
  2. **Memories**: small, atomic, third-person facts ("Prefers TypeScript"), typed as
     `fact | preference | project | person`.
  3. **Conversation history**: stays in its conversation; it is _not_ auto-summarised
     into memory.
- **Write path.** The user can add memories directly (onboarding, Settings). The agent
  can save memories through a `remember` tool when the user shares something durable;
  every save appears inline in the chat as "Remembered: … · Undo". Users can turn
  automatic saving off (`preferences.autoMemory`), in which case the agent only saves
  when asked. The tool instructions forbid secrets and sensitive categories unless the
  user explicitly asks.
- **Read path.** The most recent memories are injected into the system prompt within a
  fixed character budget (stable ordering helps prompt caching); older ones are reachable
  through a `recall` tool (keyword search today).
- **Hygiene.** Exact duplicates refresh rather than duplicate. A `forget` tool lets the
  agent correct or remove outdated memories. Settings → Memory lists everything with its
  source, and supports edit and delete.
- **Engine-neutral.** Memory tools are defined once as `HostTool`s; each engine adapts
  them (in-process MCP for Claude Code, function calling for API engines later).

## Consequences

Users can see, understand and control everything Conch remembers. Retrieval quality is
keyword-level; when memory counts grow, add local embeddings behind the same `recall`
tool without changing storage or UI. (Done in [ADR 0032](./0032-it-learns-you.md):
hybrid search, a tidy-up with Undo, and memories that wait for an OK.)

## Update (2026-10-09): Headlines

A memory learned from a long chat can run to a paragraph, and the places that sum
memories up (the morning's note, a memory's step in the chat, Activity, toasts) showed
all of it. A skill's description from another app can be as long.

- **A headline, for the person only.** `Memory.headline` (protocol, optional, at most
  80 characters, dropped rather than failing a memory) says a memory in about twelve
  plain words, in its own language, with no paths or links. It's kept in the memory's
  file as one line of JSON, inside the seal. It's never in a prompt, `recall` or the
  check: models read the memory's words, unchanged.
- **Written once, for exactly those words.** `memory/headline.ts` asks the small model
  every small job uses (`providers/small.ts`: the default provider's cheapest model,
  then another with room, then one on this computer), up to eight in one question,
  only for memories longer than a headline. Its answer is cleaned (one line, no path,
  link, code or invisible characters) or thrown away. New words drop the headline in
  `#commit`, and `setHeadline` goes through the same gate without changing anything a
  model or the check reads. A file changed outside Conch loses its headline.
- **Never for a memory that waits.** One held by the check or waiting for an OK isn't
  sent for a headline: the person reads its own words before deciding.
- **Saved, updated, or shown.** New and changed memories are asked about as they're
  written; older ones the first time `GET /api/memories` lists them, in the background,
  in batches. Nobody to ask, and it waits fifteen minutes before trying again.
- **A fallback that's honest.** Until there's a headline, `clipHeadline` takes the
  first clause, cut at a word with “…” if it's still too long. Wherever a headline
  stands in for the words, they're one press away: **Show all** in the note, the step's
  own row, the memory's page; **Undo** stays.
- **Cost.** Counted like the other small jobs: the month's spend and learning's cap.
- **Skills too.** A long skill description gets a headline the same way, kept in
  `skill-headlines.json` (derived, not backed up) by the description's hash, never in
  its `SKILL.md`, which is signed and read by every model.
