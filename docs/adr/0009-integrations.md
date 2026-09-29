# 0009 — Integrations

- Status: accepted
- Date: 2026-09-29

## Context

An agent is only as useful as what it can reach: email, calendar, docs, issues, home.
Every serious agent speaks the **Model Context Protocol (MCP)** for this, and people's
complaints about existing ones are consistent (research, Sept 2026):

- **Setup is JSON editing.** People hand-edit `claude_desktop_config.json` or YAML.
  They fight `npx`/`nvm` paths and get silent failures when a server doesn't start
  (modelcontextprotocol/servers#64, anthropics/claude-code#26073).
- **OAuth breaks and nobody notices.** Tokens expire silently, refresh races
  spend a rotating refresh token twice (OpenClaw #26322), and GitHub's remote
  server can't be used with OAuth at all without a registered app
  (claude-code#3433).
- **Tools flood the context window** and can't be switched off one by one
  (claude-code#6759).
- **Security incidents are real.** They include poisoned tool descriptions and
  "rug pulls" (Invariant Labs, 2025), a GitHub issue that made an agent leak
  private repositories, 341 malicious skills on ClawHub (Feb 2026), and tokens in
  plain config and `ps` listings (OpenClaw #80777, #83880).

## Decision

**Integrations** are MCP servers that Conch manages for you, from a gallery with
one-click setup, visible health, and plain-language control over what they may do.

### What's connected

- **Catalog.** Every remote entry was checked against the vendor's live server:
  - **OAuth services with dynamic client registration** connect in one click: Notion,
    Linear, Atlassian, Zapier, Canva, Sentry, Vercel, Supabase, Cloudflare and Stripe.
  - **GitHub** takes a fine-grained token. Its server has no dynamic registration,
    and we can't ship a client secret in a self-hosted app. The dialog links to a
    pre-filled token page.
  - **Home Assistant** takes an address and a token.
  - **A web browser** (Playwright) runs locally. The exact command is shown before
    it runs, per the MCP security best practices.
  - **Gmail, Calendar, Drive and Slack** only admit pre-approved apps. They connect
    through the provider account's own connectors (for Claude Code, claude.ai), which
    the engine loads by itself. Conch detects them and shows their state.
- **Add your own**: an address (Conch probes it and starts OAuth if it answers 401)
  or a program to run (no shell, env values stored as secrets, and a recent
  password/key required).
- **Also set up in the engine**: servers from the engine's own settings, the project,
  plugins or the provider account are listed read-only, with their real state. The
  engine polls until each has settled, so nothing shows "checking" for ever.

### Every provider, not just Claude Code

`Engine.integrations` is required, so every engine must declare how it takes part:

- **`native`** (Claude Code; Codex CLI next): the engine runs MCP servers itself. Conch
  hands them over per turn, over **stdin** (`setMcpServers`), not `options.mcpServers`.
  The SDK turns the latter into a `--mcp-config` argument that any local user could
  read with `ps`.
- **`bridge`** (plain model APIs such as OpenRouter or the Anthropic API): Conch
  connects to the servers itself (`integrations/bridge.ts`) and passes their tools as
  `TurnInput.bridgedTools`, under the same `mcp__<server>__<tool>` names. The
  permission rules run inside Conch before each call, so behaviour is identical. The
  mock engine is a bridge engine, so this path is exercised by every E2E run.
- Account connectors (`EngineIntegrations.account`) are optional. Engines without them
  simply don't offer those catalog entries.

### Health, everywhere it matters

- A probe connects with the MCP client, lists tools and turns failures into one
  sentence and one action (reconnect, edit, retry, turn on).
- Probes run when something changes, shortly after start-up, every 30 minutes, and
  whenever a turn finds a server broken.
- Tokens are refreshed before a turn (single-flight per integration). One that
  can't be refreshed marks the integration "needs sign-in" instead of failing
  silently.
- In a chat, a broken integration the turn needed (or that you named) appears inline
  as a card with the fix, and the card settles once it works again. The agent's
  prompt lists broken integrations so it can say so plainly. The sidebar shows a
  count.

### Permissions

Each integration has a policy: **Ask every time**, **Ask before changes** (the
default) or **Don't ask**. Each tool can override it with Allow · Ask · Off.

- "Read" comes from the tool's own `readOnlyHint`. It's the server's claim, so
  destructive or unannotated tools always count as changes.
- **Off** tools are removed from the model's context (`disallowedTools`, or left out
  of the bridge), which also answers the context-bloat complaint.
- **Tool definitions are pinned** (a hash of name, description, schema and hints). If
  a tool you allowed changes, its "allow" is dropped and the integration shows a
  warning: the rug-pull defence from Invariant Labs.
- "Don't ask" needs a recent password/key and is flagged by the security checkup.
- The prompt tells the agent that integration content is data, never instructions
  (Greshake et al., 2023; OWASP LLM01/LLM06 2025).

### OAuth, done by the book

- It uses the MCP SDK's client for RFC 9728 discovery, RFC 8414 metadata, RFC 7591
  registration, PKCE S256 and RFC 8707 resource indicators. No hand-rolled OAuth.
- `state` is 256 random bits, kept in memory, single use and valid for 10 minutes.
  The callback (`GET /oauth/callback`) lives outside `/api` because it's a cross-site
  top-level navigation. It spends the code at once and 303-redirects, so the code
  leaves the address bar.
- **SSRF guard** (`integrations/net.ts`) on every discovery and token request and on
  each redirect hop:
  - https only (plain http just for servers you added on your own network);
  - cloud metadata and link-local addresses are never contacted;
  - private addresses only when the integration itself is private.
- The browser only ever opens `http(s)` sign-in URLs. The sign-in opens in a popup
  (on your own "opening…" page first, to avoid popup blockers) or in this tab on
  phones or when popups are blocked.

### Secrets

- Tokens live in `~/.conch/integrations.secrets.json` (0600). They are never returned
  to the browser (it only learns _which_ fields are saved), never logged, and
  scrubbed from error text.
- The agent runs as you and could read that file, like `secrets.json`. This is the
  same documented limit as the API key.

### Logos

Brand marks ship with Nacre as inline SVG (Simple Icons, CC0). They are there on the
first frame and never fetched, which the CSP forbids anyway. Brands that asked Simple
Icons to remove their mark get a meaningful glyph or a monogram on their colour.

## Consequences

- New data: `~/.conch/integrations.json`, `integrations.secrets.json`.
- Conch now makes outbound requests to the services you connect, and only to them.
  The request shapes follow the MCP authorization spec 2025-11-25.
- There's no remote revocation on disconnect: the dialog tells you where to remove
  Conch in the service's settings.
- Codex and API engines need an `integrations` declaration to compile, which is the
  point.
