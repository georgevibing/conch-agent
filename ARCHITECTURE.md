# Architecture

Conch is a **local-first shell around an agent of your choosing**. Out of the box it
drives the Claude Code installation (and its authentication, settings, MCP servers,
hooks and CLAUDE.md files) that already exists on the host machine; it can equally
drive another agent on that machine, or a model you hold a key for. Which one is a
setting, not a rebuild — see [ADR 0010](./docs/adr/0010-providers.md).

```
┌────────────────────────── Browser ──────────────────────────┐
│  apps/web  (React 19, Vite, Nacre)                          │
│   ├─ routes: /  /s/:sessionId  /settings                    │
│   ├─ server state: TanStack Query (REST)                    │
│   └─ live state: session store fed by the WebSocket stream  │
└───────────────▲──────────────────────────────┬──────────────┘
                │ WS: ServerEvent (JSON)       │ WS: ClientCommand (JSON)
                │ HTTP: REST (sessions, fs)    │
┌───────────────┴──────────────────────────────▼──────────────┐
│  apps/server  (Node ≥ 24, Fastify + @fastify/websocket)     │
│   ├─ guards: Host/Origin checks · token for remote access   │
│   ├─ SessionManager: one AgentRun per active session        │
│   ├─ AgentRun: wraps query() from the Claude Agent SDK      │
│   │    streaming input · partial messages · canUseTool      │
│   └─ PermissionBroker: parks tool-approval promises until   │
│        the browser answers (or they time out → deny)        │
└───────────────┬─────────────────────────────────────────────┘
                │ in-process (spawns Claude Code runtime)
┌───────────────▼─────────────────────────────────────────────┐
│  Claude Code on the host: ~/.claude, project CLAUDE.md,     │
│  MCP servers, hooks, the working directory's files          │
└─────────────────────────────────────────────────────────────┘
```

## Principles

1. **Claude Code is the engine; Conch is the shell around it.** We add presentation,
   not agent logic. Behaviour (tools, permissions, memory, compaction) is Claude Code's.
2. **Every byte on the wire is typed and validated.** `@conch/protocol` owns Zod
   schemas; both ends parse, neither trusts.
3. **The server is the source of truth for sessions.** The browser can reload,
   disconnect or open a second tab and resume from the server's event log.
4. **Safe by default.** Binds to `127.0.0.1`; remote access is an explicit, documented
   opt-in (see Security).
5. **Design system first.** Screens compose Nacre; Nacre owns look, motion and a11y.

## Packages

### Design system (`packages/nacre`)

Tokens, the Lustre material, primitives (`src/components`) and chat patterns
(`src/patterns`), each with CSS Modules, stories and tests. Consumed as source
(“just-in-time” internal package) — the app's Vite build compiles it, so there is no
separate build step. Styles are wrapped in cascade layers
(`nacre.tokens < nacre.base < nacre.lustre < nacre.components < nacre.utilities`) so
apps can override predictably. Full design rationale: [docs/design/NACRE.md](./docs/design/NACRE.md).

### Wire protocol (`packages/protocol`)

Zod schemas for everything on the wire (v2):

- **REST** — `GET /api/state` (onboarding flag, persona, profile, preferences, engine
  status, workspace), `PATCH /api/settings`, `GET /api/engine?refresh=1`,
  `POST /api/engine/login` (+ `/code`, `/cancel`), `PUT|DELETE /api/engine/api-key`,
  `GET /api/providers` (+ `POST /api/providers/:id/use|check|login|signin`,
  `PUT|DELETE /api/providers/:id/key`), memory CRUD under `/api/memories`,
  conversations under `/api/conversations`.
- **WebSocket `/ws`** — `ClientCommand`: `conversation.send` (creates a conversation
  when no id is given), `conversation.subscribe` (with `afterSeq`), `conversation.interrupt`,
  `permission.respond`. `ServerEvent`: `conversation.created|updated|deleted`,
  `conversation.event`, `engine.status`, `engine.login`, `memory.changed`, `error`.
- A conversation is an **append-only log of `ConversationEvent`s** (user message,
  assistant deltas, tool start/finish, permission requested/resolved, memory
  saved/forgotten, status, turn completed). Each has a per-conversation `seq`; clients
  resubscribe with the last `seq` they saw and the server replays the rest.

### Gateway (`apps/server`)

```
src/
  config.ts, security.ts      env validation; Host/Origin guards; remote token
  services.ts                 wiring: stores, engines, conversation manager, login
  app.ts                      Fastify routes + /ws + static web app
  settings/store.ts           ~/.conch/settings.json and secrets.json (0600)
  memory/                     file-per-memory store, prompt builder, memory tools
  conversations/              manager (turns, permissions, events) + JSONL store
  engines/
    types.ts                  Engine / HostTool / EngineEvent contracts
    claude-code/              detect, login, env scrub, SDK → EngineEvent translator
    mock/                     scripted engine for UI work and E2E tests
  providers/                  the words for each engine, connecting them, switching, keys
  secrets/                    where a key lives: this computer, or 1Password (`op read`)
```

- Each turn calls `query()` from the Claude Agent SDK with `resume` (the Claude Code
  session id from the previous turn), `includePartialMessages` for token streaming,
  `systemPrompt: { preset: 'claude_code', append }` carrying personality, profile and
  memory, an in-process MCP server exposing Conch's memory tools, and `canUseTool`
  wired to inline permission prompts.
- Child processes get a scrubbed environment: variables describing a _parent_ Claude
  Code session are removed so Conch works when launched from inside Claude Code.
- **Models, thinking and modes.** `GET /api/capabilities` asks the engine what it
  offers. For Claude Code, Conch opens a session with an input stream that never sends
  anything, reads `supportedModels()` / `supportedCommands()` from the handshake and
  closes it — no API call, cached for 10 minutes. Each conversation stores its own
  `TurnOptions` (model, effort, fast mode, permission mode); unset keys fall back to
  `preferences`. Turns pass them to the SDK as `model`, `effort`, `settings.fastMode`
  and `permissionMode`.
- **Slash commands.** Three sources, resolved in this order: Conch's own commands
  (`/model`, `/effort`, `/mode`, `/fast`, `/new`, `/remember`, … — handled in the web
  app, never sent to the model), your commands (`~/.conch/commands/<name>.md`, a
  reusable prompt where `{{input}}` is replaced), and Claude Code's commands and
  skills (sent as-is; Claude Code interprets them).
- **Routines** (`routines/`): structured schedules (croner for calendar maths,
  cronstrue for custom cron), a 30-second clock with single catch-up after downtime,
  and runs executed as ordinary conversations via `ConversationManager.start()` with a
  `report_outcome` tool. Chats get `create_routine` / `list_routines` /
  `update_routine` / `delete_routine`; drafts only run once the user turns them on.
  See [ADR 0006](./docs/adr/0006-routines.md).
- **Integrations** (`integrations/`): MCP servers the user connects from a catalog
  (one-click OAuth, tokens, local programs) or adds by address/command. The service
  keeps health (probe → plain-language state + one fix action), refreshes tokens
  (single-flight), pins tool definitions, and applies per-integration / per-tool
  policies in `requestPermission`. Engines declare `integrations.mode`: `native`
  engines get servers over stdin (`setMcpServers`, never argv), `bridge` engines get
  `bridgedTools` from Conch's own MCP client. OAuth callback: `GET /oauth/callback`.
  Outbound requests pass the SSRF guard (`integrations/net.ts`). See
  [ADR 0009](./docs/adr/0009-integrations.md).
- **Providers** (`providers/`): the engines you can connect, each with the words for
  its card (`providers/catalog.ts`) and its live `EngineStatus`. The active one is
  `preferences.engine`, so switching is a click and nothing restarts; `CONCH_ENGINE`
  pins the choice and the UI says so. A provider's key is written, read and described
  in one place (`providers/keys.ts`) and lives either in `~/.conch/secrets.json`
  (0600) or in 1Password as an `op://` reference resolved by `op read` when a turn
  needs it — never to draw a page, so nobody gets a surprise fingerprint prompt.
  Keys are checked before they're kept. OpenRouter can mint one for you over PKCE
  (`providers/oauth.ts`, callback `GET /oauth/provider/:flowId`). See
  [ADR 0010](./docs/adr/0010-providers.md).
- **Usage limits.** `GET /api/usage` returns one `UsageSnapshot`, whatever the sign-in.
  - Subscriptions report plan windows (5-hour session, weekly, per-model), read
    through the SDK's structured `/usage`.
  - API key and cloud sign-ins report spend, from `~/.conch/usage.json`, against an
    optional budget.
  - `usage.changed` is pushed after every turn, on the provider's live rate-limit
    events, when a window resets, and every 5 minutes.
  - See [ADR 0005](./docs/adr/0005-usage-limits.md).
- **Chat titles.** A new chat is listed under its first line with `titling: true`
  while `conversations/title.ts` asks the engine for a 2–6 word title, alongside the
  first turn. It uses `Engine.complete()`, a one-shot call with no tools, thinking,
  MCP or session. The model is the cheapest one listed (Haiku), else the engine's
  `smallModel` alias, else the default model. For API-key and cloud sign-ins Claude
  Code runs `--bare`, which skips CLAUDE.md, rules and plugins: about $0.0002 a title
  on Haiku instead of about $0.025. A reply that fails `cleanTitle` (a refusal, a
  placeholder, too long) keeps the first line, and so do an error, a timeout or a
  rename by the user. The cost goes to the usage ledger. Toggle it with
  `preferences.autoTitle`. The web app renders both states with Nacre's `LiveTitle`
  (a shimmer while pending, a write-in when the title lands).
- API retries from the engine surface as live `notice` events ("Retrying in 4s…"),
  so a stalled provider is never a silent spinner.
- **Search.** `search/` keeps a SQLite FTS5 (trigram) index of every message in
  `~/.conch/search.db`, fed by the conversation event stream and caught up on start;
  `GET /api/search` ranks and groups hits with snippets, `GET /api/search/preview`
  shows one in context. See [ADR 0007 — Search](./docs/adr/0007-search.md).
- Local data lives in `~/.conch/` (`CONCH_HOME`): `settings.json`, `secrets.json`
  (the API key and a key per provider, or a 1Password reference to one),
  `memory/*.md`, `commands/*.md`, `routines/*.json` (+ `.runs.jsonl`), `usage.json`, `conversations/index.json` + `<id>.jsonl`, `search.db`,
  `integrations.json` + `integrations.secrets.json`, `api-sessions/<id>.json` (the
  transcript a plain model API needs, since it keeps no session of its own),
  `workspace/` (default cwd).

See [ADR 0003 — Memory](./docs/adr/0003-memory.md) and
[ADR 0004 — Engines](./docs/adr/0004-engines.md).

### Web app (`apps/web`)

- React 19 + Vite, React Router (`/`, `/c/:id`), TanStack Query for REST, a zustand
  store that folds `ConversationEvent`s into view models (pure, unit-tested reducer),
  and a reconnecting WebSocket client.
- First run is a short, skippable flow: welcome → connect Claude Code (install /
  sign-in / API key, with live re-checks) → personality and "about you" → chat.
- Assistant output: markdown → Nacre `Prose`, fenced code → `CodeBlock`, tool calls →
  `ToolCall`, permission requests → inline approval cards, memory saves → inline pills
  with undo.
- **Providers.** Settings → Providers is one card per provider: what it is, whether
  it's connected, and one button — "Use this", "Connect", or "How to install" with
  the command to copy while Conch watches for the program to appear. One dialog
  covers every path, including a key field that also takes a 1Password reference.
  First run asks which provider to use instead of assuming Claude Code.
- **Integrations.** `/integrations` shows what's connected (broken first, each with its
  one fix), a catalog with bundled logos, and what the engine has set up itself;
  `/integrations/:id` has the policy, per-tool Allow · Ask · Off and the connection.
  Connecting opens a dialog whose handshake animates through waiting → connected /
  failed; OAuth runs in a popup that lands on `/integrations/done`. Broken
  integrations show inline in chats (`integration.issue`) and as a sidebar count.
- **Search.** ⌘K (or Search in the sidebar) is one box for everything: fuzzy chat
  titles (client-side), full-text message hits from every conversation, and actions,
  with a live preview of the selected hit. Enter opens the chat at that message with
  find-in-chat (⌘F, ⌘G / ⇧⌘G) already showing every match.
- The composer toolbar carries a `ModelPicker` (provider-grouped models, thinking
  effort, fast mode, "make default") and a `ModePicker` (Ask first · Auto · Edit freely ·
  Plan only · Full trust). A `UsageMeter` in the header shows what's left of your
  tightest limit, and a `UsageNotice` appears above the composer when it runs low.
  Typing `/` opens a `CommandMenu`; `/model` and `/mode` open the
  pickers. Defaults live in Settings → Models & modes; your commands in Settings →
  Commands.

## Security model

The gateway can read and write files and run commands on the host **as the user**.
Treat it like an SSH server. Full design: [ADR 0008](./docs/adr/0008-access-and-hardening.md);
user guide: [docs/SECURITY.md](./docs/SECURITY.md).

- **Who gets in** (`apps/server/src/security.ts`, `auth/`). The owner chooses
  _password_ (scrypt, NIST SP 800-63B-4 rules), _access keys_ (`conch_…`, 256-bit,
  hashed, revocable) or _no sign-in_. With no sign-in, only genuinely local requests
  are served: loopback socket **and** loopback `Host` **and** no proxy headers.
  Everything else gets `401 setup-required`. Credentials, sessions and pairing codes
  live hashed in `~/.conch/access.json` (0600).
- **Sessions:** a fresh random cookie per sign-in (`HttpOnly; SameSite=Strict`,
  `__Host-…; Secure` over HTTPS), expiring after 30 days or 7 idle days, listed and
  revocable per device. Revoking one closes its WebSocket at once. Sensitive changes
  need a password or key from the last 10 minutes. Failed sign-ins back off per
  address and globally, and local sign-in is never locked out.
- **Pairing:** one-time, 10-minute codes, passed in the URL _fragment_
  (`/#pair=…`) as a QR code. `pnpm conch` covers every operation from the host,
  including recovery (`pnpm conch reset`).
- **Browser guards:**
  - `Host` allowlist (DNS rebinding), with loopback names, `CONCH_ALLOWED_HOSTS`,
    this machine's own addresses when listening on the network, and its Tailscale
    name;
  - Fetch Metadata;
  - `Origin` must equal the request's own host **and port**;
  - JSON-only bodies;
  - auth decided on the matched route;
  - strict CSP (no remote scripts or images, `frame-ancestors 'none'`), plus
    nosniff, no-referrer, COOP/CORP and no-store on the API.
- **Agent containment:**
  - `CONCH_*` variables never reach the agent;
  - the agent can draft routines but can't enable them or grant trust, and
    rewriting an active routine pauses it;
  - unattended runs get no routine tools, and their permission prompts expire;
  - "Always allow" lasts for the conversation only and is never written to
    Claude Code's settings;
  - integrations ask before changes by default; "Don't ask" needs a recent
    password/key and is flagged by the checkup; a tool whose definition changes
    loses "allow"; integration content is framed as data, not instructions;
  - memories are injected as facts, not instructions.
- **Memory:** at most 50 conversations are held in memory; idle ones are dropped and reloaded from disk.
- **Storage:** `~/.conch` is tightened to 0700/0600 at start-up, and every store
  builds paths with `safeJoin`. All wire ids are `Id` (no dots or slashes).
- **Logs** never contain query strings, headers or bodies. There is no telemetry.
- **Checkup:** `auth/checkup.ts` turns the configuration into plain-language
  warnings, shown in Settings → Security, at start-up and in `pnpm conch status`.

Known limits:

- With sign-in off, other OS users on the same machine can reach loopback. The
  checkup suggests a password.
- The agent can read `ANTHROPIC_API_KEY`, which it needs.
- Claude Code loads the workspace's own `.claude/` settings; the checkup warns when they add hooks, auto-allowed tools or MCP servers.
- Breached-password checks use a local blocklist only.

## Quality gates

| Layer         | Tooling                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| Types         | TypeScript 6, `strict`, `noUncheckedIndexedAccess`                                            |
| Lint          | ESLint 9 flat config, typescript-eslint strict, jsx-a11y strict, react-hooks (compiler rules) |
| Format        | Prettier                                                                                      |
| Unit / a11y   | Vitest + Testing Library + jest-axe                                                           |
| Visual        | Storybook 10 (+ a11y addon), `scripts/snap.mjs` screenshots                                   |
| Orchestration | Turborepo (`pnpm check`)                                                                      |

## Decisions

Recorded in [docs/adr](./docs/adr). Start with
[0001 — Monorepo & tooling](./docs/adr/0001-monorepo-and-tooling.md) and
[0002 — Nacre design system](./docs/adr/0002-nacre-design-system.md).
