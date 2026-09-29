# 0012 — Every provider at once

- Status: accepted
- Date: 2026-09-29
- Amends: [ADR 0010](./0010-providers.md) ("Conch uses one provider at a time")

## Context

ADR 0010 made the provider a setting: one is **in use**, the rest wait, and
switching is a click in Settings. In practice that is still one thing too many.
People connect Claude Code _and_ OpenRouter because they want Opus for one chat
and a cheap open model for the next — and they want to make that choice where
they make every other choice about a reply: the model picker. Having to visit
Settings → Providers to change which list the picker shows, and losing the
other models meanwhile, is the "use one or the other" feeling people object to.

OpenClaw's gateway works the way people expect: every configured provider
contributes models to one list, `provider/model` names a choice, and the tools
(skills, MCP servers, channels) belong to the gateway rather than to whichever
model is answering.

## Decision

**Every connected provider is available at the same time.** The model picker
lists the models of all of them, grouped by provider and searchable by name.

### A choice is a provider and a model

- `TurnOptions.engine` joins `model`: a conversation (or the new-chat draft)
  remembers which provider answers, as well as which of its models.
- `preferences.engine` keeps its name but changes meaning from "the provider in
  use" to **the default** — what a new chat starts with when you haven't
  picked. `preferences.model` is that provider's default model. "Make this my
  default" in the picker saves both.
- `GET /api/models` returns every ready provider with its models, permission
  modes and commands (`ModelCatalog`). A provider that isn't connected simply
  isn't there; one that fails to list its models is there with a message and
  no models, so the picker can say why.
- Settings → Providers loses "Use this" / "In use". Every card says whether the
  provider is connected; the default wears a quiet **Default** badge and the
  others offer "Make default".

### Changing provider mid-conversation keeps the conversation

Each engine keeps its own session (Claude Code's session id, Codex's thread,
the API engines' transcript), and none of them can read another's. So a
conversation stores **one session per provider** (`sessions[engine] = { resumeId,
seq }`, where `seq` is the last event that session has seen). When a turn runs
on a provider, Conch resumes that provider's own session and hands it what was
said since it last took part — the user's messages and the replies from other
providers, oldest dropped first to stay within a budget — framed as earlier
conversation, not as instructions. A provider joining for the first time gets
the whole conversation the same way. Nothing is summarised by a model: the
handoff is the transcript, so it's cheap, instant and faithful.

### Everything else follows the conversation's provider

- The turn's engine decides tool shape (native MCP vs Conch's bridge), whether
  host tools are offered, and the permission modes the mode picker shows.
- The chat title is written by the conversation's provider, on its cheapest
  model, as before.
- Routines run on the provider their options name, else the default.
- Usage limits stay the default provider's (they're per account, not per chat).

### Integrations belong to Conch

Integrations you connect in Conch are handed to **every** provider for every
turn — natively or through the bridge (ADR 0009) — so the Integrations page
talks about Conch, not about one provider:

- Catalog tiles show only what's connected in Conch. A service that can only be
  reached through a provider's own account (Gmail, Calendar, Drive and Slack
  admit only pre-approved apps) says which provider brings it and that it only
  works with that provider's models, instead of wearing a green tick.
- Servers a provider configured by itself (Claude Code's settings, plugins, its
  account's connectors) are listed per provider under **From your providers**,
  collapsed, each saying it only works with that provider — with a "Use with
  every model" action when Conch can connect the same service itself.

## Consequences

- `TurnOptions` gains `engine`; `ConversationRecord` gains `sessions`. The old
  single `resumeId` is read as the recorded engine's session, so existing chats
  continue where they left off.
- New route `GET /api/models`. `GET /api/capabilities` still answers for the
  default provider (and takes `?engine=`).
- `IntegrationsList.provider` becomes `providers` (one per ready provider) and
  `ExternalIntegration` gains `provider`/`providerName`.
- `CONCH_ENGINE` still pins: only that provider is listed, so `pnpm dev:mock`
  and E2E runs behave as before.
- A handoff costs input tokens proportional to what the joining provider missed,
  capped (60,000 characters, newest kept).
