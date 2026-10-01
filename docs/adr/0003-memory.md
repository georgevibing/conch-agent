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
