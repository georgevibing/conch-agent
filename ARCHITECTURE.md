# Architecture

Conch is a **local-first facade over Claude Code**. It never talks to the Anthropic
API itself: it drives the Claude Code installation (and its authentication, settings,
MCP servers, hooks and CLAUDE.md files) that already exists on the host machine.

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
  memory CRUD under `/api/memories`, conversations under `/api/conversations`.
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
```

- Each turn calls `query()` from the Claude Agent SDK with `resume` (the Claude Code
  session id from the previous turn), `includePartialMessages` for token streaming,
  `systemPrompt: { preset: 'claude_code', append }` carrying personality, profile and
  memory, an in-process MCP server exposing Conch's memory tools, and `canUseTool`
  wired to inline permission prompts.
- Child processes get a scrubbed environment: variables describing a _parent_ Claude
  Code session are removed so Conch works when launched from inside Claude Code.
- Local data lives in `~/.conch/` (`CONCH_HOME`): `settings.json`, `secrets.json`,
  `memory/*.md`, `conversations/index.json` + `<id>.jsonl`, `workspace/` (default cwd).

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

## Security model

The gateway can read and write files and run commands on the host **as the user**.
Treat it like an SSH server.

- Binds `127.0.0.1` by default. Binding elsewhere requires `CONCH_ALLOW_REMOTE=1`
  **and** a `CONCH_TOKEN` (16+ chars); the browser presents it once via `?token=` and
  receives an `HttpOnly`, `SameSite=Strict` cookie. Prefer an SSH tunnel or Tailscale
  over a public port.
- **DNS-rebinding guard:** requests are answered only when `Host` is loopback,
  `CONCH_ALLOWED_HOSTS`, or the configured remote host.
- **Cross-site guard:** WebSocket upgrades and all non-GET requests carrying an
  `Origin` must come from an allowed host, so a web page can't drive the agent.
- Tool permissions are never auto-approved by the gateway (except Conch's own memory
  tools, whose effects are shown inline); "Always allow" is scoped to the conversation.
- Secrets (API keys) live in `~/.conch/secrets.json` (0600) and are never returned to
  the browser. No telemetry.

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
