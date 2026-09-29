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
│   ├─ auth: pairing token → httpOnly session cookie          │
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

Zod schemas for:

- `ClientCommand` (browser → server): `session.create`, `session.send`,
  `session.interrupt`, `permission.respond`, `session.subscribe` (with `afterSeq`
  for resumption), `session.setMode`.
- `ServerEvent` (server → browser): `session.state`, `message.delta` (streamed text/
  thinking), `message.complete`, `tool.started` / `tool.progress` / `tool.finished`,
  `permission.requested`, `result` (cost, usage, duration), `error`.

Every `ServerEvent` has a per-session monotonically increasing `seq`; clients
re-subscribe with the last seen `seq` and the server replays from its ring buffer.

### Gateway (`apps/server`)

- **Fastify** for HTTP (health, session list/history, directory picker) and
  **@fastify/websocket** for the live stream. One socket per tab, multiplexing
  sessions by id.
- **AgentRun** wraps `query({ prompt, options })` from `@anthropic-ai/claude-agent-sdk`:
  - `prompt` is an `AsyncIterable<SDKUserMessage>` fed by a queue, so follow-up
    messages stream into the same live session.
  - `includePartialMessages: true` for token-level streaming.
  - `resume: sessionId` to continue Claude Code sessions (including ones started in
    the terminal).
  - `canUseTool` delegates to the **PermissionBroker**, which emits
    `permission.requested` and awaits the browser's `permission.respond`.
  - `permissionMode` is surfaced as a UI toggle (`default`, `acceptEdits`, `plan`, …).
  - `query.interrupt()` backs the Stop button.
- SDK messages are translated into protocol events in a single pure module
  (`translate.ts`) with exhaustive `switch`es — unknown message types are logged
  and dropped, never forwarded raw.

### Web app (`apps/web`)

- React 19 + Vite, React Router for routes.
- **TanStack Query** for REST data; a small **Zustand** store per session for the live
  event stream (append-only, keyed by `seq`, derived selectors for render).
- Rendering assistant output: markdown → Nacre `Prose`, fenced code → `CodeBlock`,
  tool calls → `ToolCall`, permission requests → inline approval cards.
- Virtualised transcript for long sessions; the composer is always reachable
  (`⌘K` command palette, `Esc` to interrupt).

## Security model

The gateway can read and write files and run commands on the host **as the user**.
Treat it like an SSH server.

- Binds `127.0.0.1` by default. `CONCH_HOST=0.0.0.0` prints a loud warning and
  requires `CONCH_ALLOW_REMOTE=1`; the recommended remote path is an SSH tunnel or
  Tailscale, never a public port.
- First run prints a one-time **pairing token**; the browser exchanges it for a
  signed, `httpOnly`, `SameSite=Strict` cookie. WebSocket upgrades check the cookie
  and `Origin`.
- Tool permissions are never auto-approved by the gateway; `bypassPermissions` must be
  chosen per session in the UI and is visually loud.
- No telemetry. Logs redact prompt content unless `CONCH_LOG_CONTENT=1`.

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
