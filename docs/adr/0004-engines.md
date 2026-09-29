# 0004 — Engines

- Status: accepted
- Date: 2026-09-29

## Context

Conch starts as a facade over Claude Code but should later drive other runtimes —
Codex CLI, the Anthropic API directly, or OpenRouter keys — without rewrites.

## Decision

- An **`Engine`** interface (`apps/server/src/engines/types.ts`) with four
  capabilities: `detect()` (installed? signed in? how?), optional `login()` and
  `setApiKey()`, and `runTurn()` which yields a small, normalised `EngineEvent`
  stream (session, text, thinking, tool start/end, done).
- Everything above the engine — conversations, permissions, memory, personality, the
  wire protocol, the UI — depends only on that interface. `EngineId` in the protocol
  already reserves `codex-cli`, `anthropic-api` and `openrouter`.
- **Claude Code** is implemented with the Claude Agent SDK, pointing
  `pathToClaudeCodeExecutable` at the user's own `claude` so Conch shares their
  version, login, settings, MCP servers and `CLAUDE.md` files. Status comes from
  `claude auth status --json`; sign-in drives `claude auth login`.
- A **mock engine** implements the same interface for UI development and end-to-end
  tests (`CONCH_ENGINE=mock`, `CONCH_MOCK_STATE=not-installed|signed-out|ready`).

## Consequences

Adding an engine is one folder under `engines/` plus a registry entry. Engines that
lack tools natively (plain API) will need Conch-side tool execution; the `HostTool`
abstraction is the seam for that.
