# 0010 — Providers

- Status: accepted
- Date: 2026-09-29

## Context

[ADR 0004](./0004-engines.md) reserved the engine ids and built the `Engine`
interface, but only Claude Code was ever wired up, and it showed: the Settings
section was called **Claude Code**, the engine was chosen by an environment
variable (`CONCH_ENGINE`) nobody sets, and the first-run flow said "let's connect
to Claude" as if there were nothing else.

What people actually have on their machines (research, Sept 2026) is more varied,
and each of these is a different kind of connection:

- an agent **already installed and signed in** — Claude Code, Codex;
- a **subscription** they already pay for (Claude, ChatGPT);
- a **key** for a gateway with every model behind it (OpenRouter) or for one lab
  (the Anthropic API);
- keys they keep **in a password manager**, not in dotfiles.

The recurring complaints are the same shape as the integrations ones (ADR 0009):
setup is JSON editing, keys end up in plaintext config, switching means editing a
file and restarting, and nothing tells you which provider a reply came from.

## Decision

**Providers** are the engines you can connect, presented as one screen with live
state, one button each, and the one in use wearing a ring.

### The choice is yours, and it's remembered

- `GET /api/providers` returns every provider: what it is in plain words, its
  live `EngineStatus`, whether a key is saved and what connecting would take.
- The active provider is `preferences.engine` in `settings.json` — a preference,
  not an environment variable. `POST /api/providers/:id/use` changes it, and
  every turn after that goes through the new engine (`Services.engine()` reads
  it, so nothing needs restarting).
- `CONCH_ENGINE` still wins, but its meaning is now a **pin**: the UI says
  "Conch was started with CONCH_ENGINE=…, so the provider is fixed" instead of
  offering a switch that wouldn't take. That keeps `pnpm dev:mock` and the E2E
  runs honest.
- Product copy never says "Claude Code" where it means "your provider".
  Settings → **Providers**; first run asks **"Choose what powers me"**.

### Three ways to connect, one dialog

- **A program on this computer** (`connect: 'program'`): install hints with
  copy buttons while Conch watches for the binary to appear, then the CLI's own
  sign-in driven through `Engine.login()`.
- **A key** (`connect: 'key'`): a field that also accepts a 1Password
  reference — see below.
- **One click**, where the provider will mint a key for you: OpenRouter's PKCE
  flow (`providers/oauth.ts`). No key is ever copied by hand.

### Keys: one place, two homes

`ProviderKeys` (`providers/keys.ts`) is the only code that writes, reads or
describes a provider's key. `SecretVault` (`secrets/vault.ts`) decides where it
lives:

- **Conch** — `~/.conch/secrets.json`, mode 0600, like every other file there.
- **1Password** — Conch stores only the reference (`op://Vault/Item/field`) and
  asks the `op` command for the value when a turn needs it.

Rules that hold everywhere:

- The browser learns **that** a key exists, where it lives and its last four
  characters. Never the value. (`SavedSecret` carries no secret.)
- A key is **checked before it's kept**: the shape is matched, a 1Password
  reference is resolved once, and the engine is asked to re-detect. If any of
  that fails, the previous key is restored and the dialog says why. "Saved"
  means it works.
- Reading a secret can involve a **person** (a fingerprint), so it only happens
  when a turn needs it. Drawing Settings, or checking whether a provider is
  connected, uses `peek` — memory only. Nobody gets a biometric prompt for
  opening a settings panel.
- Resolved values are cached in memory for five minutes, which also keeps us
  well inside 1Password's read quota (1,000/hour on Individual and Families).
- The older top-level `anthropicApiKey` is still read, and retired the next time
  a key is saved.

**Why the `op` CLI and not `@1password/sdk`.** The SDK is a new runtime
dependency, still on 0.x with breaking minors, and it only supports service
accounts or explicit desktop auth. The CLI is already how developers use
1Password, works with whatever auth they have (desktop unlock, a service
account token we pass through, or Connect), and `op read` takes **only the
reference** as an argument — the value comes back on stdout, so nothing
sensitive is visible in `ps`. (1Password's own docs warn about argv for
_writes_, not reads.) Two caveats we surface rather than hide: a service account
can never read the built-in Private/Employee vaults, and a locked app revokes
prior authorisation, so a turn may need an unlock.

### OpenRouter's one-click key, done by the book

- PKCE S256, no client secret — a self-hosted app can't keep one, which is
  exactly the case OpenRouter's flow is designed for. Localhost callbacks on any
  port are supported.
- OpenRouter's flow has no `state` parameter, so the **flow id lives in the
  callback path** (`GET /oauth/provider/:flowId`) and does the same job: 256
  random bits, in memory only, single use, ten minutes, constant-time lookup.
  Without it a code is worthless, and the code is itself single-use and bound to
  our verifier.
- The callback sits outside `/api` because it's a cross-site top-level
  navigation (same reasoning as the integrations callback), spends the code at
  once and 303-redirects, so the code leaves the address bar.
- The exchange goes to a fixed https address we chose, so there's no SSRF
  surface; the response is parsed with Zod and only a `key` is accepted.

### Honesty about what each provider can do

Features ask the engine, never the name (AGENTS.md rule 9), and the UI says what
the answer means:

- **Claude Code** — `integrations.mode: 'native'`, full permission modes, the
  provider account's own connectors.
- **Codex** — `native`, but `codex exec` forces approvals off and has no channel
  to ask a supervisor, so Conch cannot prompt per action. It declares only the
  modes Codex can honour, maps them to `--sandbox`, and the card and dialog say
  "Codex works inside its own sandbox, so Conch can't ask you before each step."
  Marked **early support** rather than presented as finished.
- **OpenRouter / the Anthropic API** — `bridge` engines: Conch holds the MCP
  connections and runs the permission rules itself, so integrations behave the
  same. They have no filesystem or shell tools at all, and declare
  `permissionModes: ['default']` instead of pretending.

`Engine.hostTools` is the other declared capability this added: an engine that
can't run Conch's own tools (Codex, whose `exec` takes no tool definitions) is
never told about them, so the prompt stops promising a memory it can't save. The
system prompt no longer claims to be "Claude, working through Claude Code"
either — what a provider can actually do is the provider's own sentence.

### 1Password as an integration, too

The catalog gains **1Password**: the Environments MCP server (`1password-mcp`,
shipped with the desktop app, stdio only; on Windows too, as an app alias. See
ADR 0016, which also installs the app when it's missing). It manages
Environments and variable _names_; by explicit 1Password design it never returns
a secret value to a client, and the entry says so. Enabling it takes two
toggles in the 1Password app, which the dialog lists as steps.

## Consequences

- New data: `secrets.json` gains `providers` (a `StoredSecret` per engine id),
  and `api-sessions/<id>.json` holds the transcript a plain model API needs —
  it keeps no session of its own, so Conch sends the conversation each time.
  Both are 0600 like everything in `~/.conch`.
- New routes: `GET /api/providers`, `POST /api/providers/:id/use|check|login|signin`,
  `PUT|DELETE /api/providers/:id/key`, and `GET /oauth/provider/:flowId`.
  `GET /api/engine` and `PUT /api/engine/api-key` still work and now act on the
  active provider.
- `CONCH_ENGINE` changes meaning from "the engine" to "the engine, fixed".
- Settings → Claude Code is gone; `EngineConnect` went with it, replaced by
  `ProviderSetup` and one `ConnectProviderDialog` that covers every path.
- Conch now makes outbound requests to whichever providers you connect, and runs
  `op` when a key lives in 1Password.
- Adding a provider is still one folder under `engines/` plus a registry entry —
  now with one entry in `providers/catalog.ts` for the words.

## Sources

- OpenRouter OAuth PKCE, `GET /api/v1/key`, `/api/v1/models/user`, streaming and
  error semantics — openrouter.ai/docs (Sept 2026).
- Codex CLI `exec --json` event schema, forced `approval_policy: never`, no
  approval channel outside `app-server`, `codex login --with-api-key` on stdin —
  openai/codex source and learn.chatgpt.com/docs (Sept 2026).
- 1Password secret references, `op read`, desktop-app session limits, service
  account scoping and rate limits, and the Environments MCP server —
  1password.dev (Sept 2026), plus "Where MCP fits, and where it doesn't"
  (1Password, 2025) for why an MCP server must not hand over credentials.
- Anthropic API `/v1/messages` streaming, `thinking: {type:'adaptive'}` with
  `output_config.effort`, `GET /v1/models` — platform.claude.com (Sept 2026).
- OWASP ASVS 5.0 (secret storage, session binding) and the OAuth 2.0 Security
  Best Current Practice for the PKCE and single-use-state reasoning.
