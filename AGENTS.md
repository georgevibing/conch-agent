# AGENTS.md

Operating manual for AI coding agents (and humans) working in **Conch**. Read this
first, then follow the routing table to the one document that covers your task.
Nested `AGENTS.md` files override this one for their subtree.

## What Conch is

A self-hosted web shell for the coding agents and models of your choosing. A small
Node gateway runs on your own machine, drives every provider you connected — [Claude
Code](https://code.claude.com) through the Claude Agent SDK, another installed CLI,
or a model API — all at once, from one model picker, and streams the conversation to
a React web app built on **Nacre**, our own design system. Integrations and skills
belong to Conch, so they work with every provider. See
[ARCHITECTURE.md](./ARCHITECTURE.md).

**The Conch promise.** Anyone can use it, including people who have never opened a
terminal. Conch sets itself up, fixes what breaks before anyone notices, and
interrupts only to ask for approval of something that matters, or for the one
thing only a person can do. Every feature is judged by that promise first. See
working agreement 11: _fix it before you ask_.

## Routing — where to go for what

| If your task involves…                                                                               | Read / work in                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any UI component, token, animation, theming, Storybook                                               | [`packages/nacre/AGENTS.md`](./packages/nacre/AGENTS.md) → [`docs/design/NACRE.md`](./docs/design/NACRE.md)                                                                                                                                                                   |
| The web app (routes, state, data fetching, chat screens)                                             | `apps/web/` + [ARCHITECTURE.md § Web app](./ARCHITECTURE.md#web-app-appsweb)                                                                                                                                                                                                  |
| The gateway / Claude Code integration / permissions                                                  | `apps/server/` + [ARCHITECTURE.md § Gateway](./ARCHITECTURE.md#gateway-appsserver)                                                                                                                                                                                            |
| Wire protocol between web and gateway                                                                | `packages/protocol/` + [ARCHITECTURE.md § Protocol](./ARCHITECTURE.md#wire-protocol-packagesprotocol)                                                                                                                                                                         |
| Lint / TS config shared across packages                                                              | `packages/eslint-config/`, `packages/tsconfig/`                                                                                                                                                                                                                               |
| Integrations (apps/MCP servers, OAuth, the catalog)                                                  | `apps/server/src/integrations/` + [ADR 0009](./docs/adr/0009-integrations.md) — security-relevant                                                                                                                                                                             |
| Providers (which engine runs, connecting them, keys)                                                 | `apps/server/src/providers/`, `apps/server/src/secrets/` + [ADR 0010](./docs/adr/0010-providers.md), [ADR 0012](./docs/adr/0012-every-provider-at-once.md) — security-relevant                                                                                                |
| A model on this computer (Ollama, pulls, offline)                                                    | `apps/server/src/local/`, `engines/api/ollama.ts`, `apps/web/src/features/local/` + [ADR 0022](./docs/adr/0022-a-model-on-this-computer.md) — security-relevant                                                                                                               |
| Skills (SKILL.md, other agents' folders, `use_skill`)                                                | `apps/server/src/skills/` + [ADR 0013](./docs/adr/0013-skills.md) — security-relevant                                                                                                                                                                                         |
| The browser (live view, takeover, per-site permissions)                                              | `apps/server/src/browser/`, `apps/web/src/features/browser/`, `packages/nacre/src/patterns/Browser/` + [ADR 0014](./docs/adr/0014-browser.md) — security-relevant                                                                                                             |
| The terminal (shells on the host, the drawer, who may open one)                                      | `apps/server/src/terminal/`, `apps/web/src/features/terminal/`, `packages/nacre/src/patterns/Terminal/` + [ADR 0015](./docs/adr/0015-terminal.md) — security-relevant                                                                                                         |
| Something a feature needs installed (apps, CLIs, runtimes)                                           | `apps/server/src/setup/`, Nacre `SetupChecklist` + [ADR 0016](./docs/adr/0016-getting-what-a-feature-needs.md) — security-relevant                                                                                                                                            |
| Updates (Conch itself, the programs it uses, rollback)                                               | `apps/server/src/updates/`, `apps/web/src/features/health/UpdatesSection.tsx`, Nacre `SoftwareUpdate` + [ADR 0019](./docs/adr/0019-updates.md) — security-relevant                                                                                                            |
| Attachments (long pastes, files, pictures, drop, previews)                                           | `apps/server/src/attachments/`, `apps/web/src/features/chat/`, Nacre `Attachments` + [ADR 0017](./docs/adr/0017-attachments.md) — security-relevant                                                                                                                           |
| Passwords (the vault, other password managers, filling sign-ins)                                     | `apps/server/src/vault/`, `apps/web/src/features/passwords/`, Nacre `Passwords` + [ADR 0025](./docs/adr/0025-passwords.md), [§ Adding a password manager](#adding-a-password-manager) — security-relevant                                                                     |
| Backups (what's in one, the format, restore, automatic backups)                                      | `apps/server/src/backup/`, `apps/web/src/features/health/`, Nacre `Backups` + [ADR 0020](./docs/adr/0020-backups.md) — security-relevant                                                                                                                                      |
| Channels (Telegram, Discord, Slack: reaching your assistant)                                         | `apps/server/src/channels/`, `apps/web/src/features/channels/`, Nacre `Channels` + [ADR 0018](./docs/adr/0018-channels.md), [§ Adding a channel](#adding-a-channel) — security-relevant                                                                                       |
| What ⌘K can find by name                                                                             | `apps/web/src/features/palette/` (`findables.tsx`) — see working agreement 10                                                                                                                                                                                                 |
| Repair everything (the whole-Conch checkup, Settings → Health)                                       | `apps/server/src/doctor/` (`checks.ts`), `apps/web/src/features/health/`, Nacre `RepairPanel` — see working agreement 12                                                                                                                                                      |
| Offline, usage limits, who answers a turn                                                            | `Services.route`, `apps/server/src/network/`, `ConversationManager` + [ADR 0023](./docs/adr/0023-offline-and-limits.md)                                                                                                                                                       |
| Offering to connect an app from the chat (cues, the offer card)                                      | `apps/server/src/integrations/cues.ts`, `catalog.ts`, web `features/integrations/ChatBits.tsx` + [ADR 0021](./docs/adr/0021-connect-from-chat.md) — see working agreement 12                                                                                                  |
| Always on, the installer, Conch as an app (`pnpm conch background`)                                  | `apps/server/src/background/`, `scripts/install.sh`, `scripts/install.ps1`, web `features/background/`, Nacre `AlwaysOn` + [ADR 0026](./docs/adr/0026-always-on.md) — security-relevant                                                                                       |
| Phones: the secure address (Tailscale), the app (manifest, `sw.js`), notifications (Web Push), voice | `apps/server/src/network/tailscale.ts`, `push/`, `voice/`, web `features/{phone,pwa,notifications,voice}/`, Nacre `Notifications`, `Voice` + [ADR 0027](./docs/adr/0027-in-your-pocket.md) — security-relevant                                                                |
| Safe hands: the guard after reading, sealed commands, Activity, skills read first                    | `apps/server/src/conversations/{taint,sandbox}.ts`, `engines/claude-code/engine.ts` (PreToolUse), `activity/`, `skills/scan.ts`, web `features/{safety,activity}/`, Nacre `Safety`, `Activity`, `SkillReview` + [ADR 0028](./docs/adr/0028-safe-hands.md) — security-relevant |
| Conch restarting itself, surviving a crash                                                           | `apps/server/src/supervisor.ts`, `lib/lifecycle.ts` (`restart()`), web `features/health/restart.ts`                                                                                                                                                                           |
| A decision that changes architecture or adds a dependency                                            | Write an ADR in [`docs/adr/`](./docs/adr/) first                                                                                                                                                                                                                              |
| Devices, approving new ones (`pnpm conch devices`)                                                   | `apps/server/src/auth/` (`store.ts`, `devicesCli.ts`), `security.ts`, web `features/auth/`, Nacre `DeviceApproval` + [ADR 0024](./docs/adr/0024-approve-new-devices.md) — security-relevant                                                                                   |
| Security, auth, exposing the gateway beyond localhost                                                | [§ Security engineering](#security-engineering) below → [ARCHITECTURE.md § Security](./ARCHITECTURE.md#security-model) → [ADR 0008](./docs/adr/0008-access-and-hardening.md) — treat as high-risk                                                                             |

**Rule of thumb:** UI goes in Nacre _first_. If an app screen needs a visual element
that doesn't exist, build it as a Nacre primitive or pattern (with a story), then use
it. Apps must not contain bespoke styling beyond layout.

## Repo map

```
apps/
  web/            React 19 + Vite SPA (the chat UI)
  server/         Node gateway: HTTP + WebSocket, wraps @anthropic-ai/claude-agent-sdk
packages/
  nacre/          Design system: tokens, Lustre material, components, patterns, Storybook
  protocol/       Zod schemas + types for every message on the wire
  eslint-config/  Shared flat ESLint configs (base, react)
  tsconfig/       Shared tsconfig bases
docs/
  design/         Design language (NACRE.md)
  adr/            Architecture decision records
scripts/          Repo tooling (e.g. snap.mjs visual QA screenshots)
```

## Commands

Run from the repo root unless noted. Node ≥ 24, pnpm 12 (`corepack enable` or `npm i -g pnpm`).

| Command                                                                     | What it does                                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                              | Install everything                                                                                                     |
| `pnpm dev`                                                                  | Run all dev servers via Turbo                                                                                          |
| `pnpm storybook`                                                            | Nacre Storybook on http://localhost:6006                                                                               |
| `pnpm check`                                                                | Format check + lint + typecheck + tests. **Must pass before every commit.**                                            |
| `pnpm test`                                                                 | All unit tests (Vitest)                                                                                                |
| `pnpm e2e`                                                                  | Builds the web app and runs Playwright journeys against the gateway + mock engine                                      |
| `pnpm dev:mock`                                                             | Dev servers with the scripted mock engine (no Claude usage)                                                            |
| `pnpm start`                                                                | Build and run Conch for real at http://localhost:4317                                                                  |
| `pnpm start:network`                                                        | Same, reachable from your network (sign-in required; prefer Tailscale)                                                 |
| `pnpm conch <command>`                                                      | From the terminal: `status`, `password`, `key`, `pair`, `devices`, `reset`, `background`, `quit` … (`pnpm conch help`) |
| `pnpm --filter @conch/nacre test -- src/components/Button`                  | Tests for one component                                                                                                |
| `pnpm a11y [--filter=button]`                                               | axe (incl. colour contrast) on every story, light + dark, in real Chrome (Storybook must be running)                   |
| `node scripts/snap.mjs <story-id> [--mode=dark] [--hover=css] [--clip=css]` | Screenshot a story for visual QA (Storybook must be running)                                                           |

## Working agreements

1. **Verify, don't assume.** Run the relevant tests/typecheck/lint after every change.
   For UI changes, also screenshot the affected stories in light _and_ dark mode with
   `scripts/snap.mjs` and look at them.
2. **Small, conventional commits** (`feat(nacre): …`, `fix(server): …`, `docs: …`,
   `chore: …`). One logical change per commit. Never push unless asked.
3. **Dependencies are decisions.** Prefer what's already installed. New runtime deps
   need a line of justification in the commit message; significant ones need an ADR.
   pnpm enforces a minimum release age — don't bypass it.
4. **Types are the contract.** `strict` + `noUncheckedIndexedAccess`. No `any`; use
   `unknown` + narrowing. Anything crossing the network is validated with Zod from
   `@conch/protocol` on _both_ sides.
5. **Accessibility is not optional.** `jsx-a11y` strict is on and never disabled.
   Every interactive component has keyboard support, visible focus, and an axe test.
6. **No secrets in code or logs.** Config comes from env (`.env.example` documents it).
7. **Inclusive language** in code, comments and docs (primary/replica, allowlist/denylist).
8. **Don't edit generated or vendored files** (`pnpm-lock.yaml` by hand, `dist/`,
   `storybook-static/`).
9. **Design for every provider, not just Claude Code.** Conch drives several
   engines at once (Claude Code, Codex CLI, OpenRouter, the Anthropic API, local
   models next), and one conversation can move between them. Every feature must
   work for all of them, or degrade on purpose:
   - Never assume one active engine. The engine for a turn is the conversation's
     (`TurnOptions.engine`); the default provider only decides where new chats
     start. Ask `providers.engineFor(id)` or `providers.ready()`, not `engine()`.
   - What the user sets up — integrations, skills, memory, routines — belongs to
     Conch and reaches every provider. What a provider brings by itself is shown
     apart, and says it only works with that provider.
   - Put engine-specific behaviour behind the `Engine` interface
     (`apps/server/src/engines/types.ts`), as a declared capability. Features ask
     the engine what it can do (e.g. `engine.integrations.mode`, `usage?`,
     `complete?`); they never check which engine it is.
   - Keep the protocol and UI generic. Use the engine's `label` and the
     assistant's name (`persona.name`), never a hard-coded "Claude" or "Claude
     Code" in product copy (a few older screens still do: fix them when you
     touch them). Give things generic names (`account` connectors, not
     `claude-ai`).
   - When an engine lacks a capability, Conch fills the gap where it reasonably
     can (e.g. the MCP bridge for engines without MCP) or hides the feature with
     an explanation. It never breaks.
   - The mock engine is the second provider: it takes the other path where one
     exists (it's a "bridge" engine for integrations), so both paths are tested.
10. **If a person can find it by name, ⌘K finds it.** The palette is the one box
    for everything: chats and messages, and every other thing a person can open,
    use or change by name — skills, models from every provider, integrations,
    routines, pages, settings sections and actions. When you add a new kind of
    thing or a new page, register it in `apps/web/src/features/palette/findables.tsx`
    (with the words people would type) in the same change, and extend
    `Palette.test.tsx`. Choosing it does the obvious thing: open it, or use it
    right there (a skill goes into the composer, a model applies to the chat).
11. **Fix it before you ask.** Conch is for people who don't debug. When something
    is missing, stale or broken, Conch repairs it itself and carries on. The person
    is asked only for approvals that matter, or for what only they can do. Proactive,
    never intrusive:
    - **Heal first.** Handle every failure you can foresee, in code, without asking:
      - Install what's missing (with progress) and fall back to the next good
        option.
      - Clear stale locks and orphaned processes.
      - Relaunch what crashed and restore where it was.
      - Retry flaky networks lighter and with backoff.
      - Refresh expired tokens.

      The browser (ADR 0014) is the reference: it finds a browser or downloads
      one, clears a dead profile lock, falls back from Chrome to Edge to
      Chromium, relaunches after a crash and reopens each chat's page, and
      declines cookie banners.

    - **Offer to get what's missing.** When a feature needs something outside Conch
      (an app, a CLI, a runtime), don't report it missing. Declare it as a _need_
      (`apps/server/src/setup/known.ts`, ADR 0016), and the UI turns it into one
      button:
      - **Find it where it really lives** before saying it's missing: `PATH` as the
        OS sees it (Windows app aliases in `WindowsApps` fail `existsSync`; use
        `presentSync`/`findExecutable`), macOS app bundles, the folders installers
        use. Run what you found by its full path.
      - **Install it for them** when a package manager can do it without an
        administrator (winget, Homebrew, npm into a user prefix). Offer it as
        “Install X”, show the exact command, show progress, then carry on to the
        thing they asked for. No second press.
      - **Link to it** when only a person can install it (`sudo`, an app store,
        a licence). Then watch: poll while missing, and look again on window focus.
      - **Point at the switch** when it's installed but turned off in another app:
        name the setting, offer “Open <app>”, and check again when they come back.
      - A card says what's missing in a few words (“Needs the 1Password app.”) with
        **Finish setup**, never a program name and **Try again**.
      - The pieces: a status or health carries `fix: {need, kind}` / `need`, the web
        shows `<GetIt needId=…>` (features/setup), and `Services.needLanded` re-checks
        whatever was waiting when an install lands.
    - **Retry what passes by itself.** A failure that usually clears (a server
      restarting, a blip offline, an expired token) is retried with backoff and a
      renewal, not handed to the person as “Try again”. Only ask when the fix
      really is theirs (a revoked sign-in). A chat whose provider failed offers
      the next best thing — sign in (then resend by itself), another provider that
      is ready, or opening 1Password — from the turn's `problem`.
    - **Say what you fixed, quietly.** Record each repair with
      `services.healed.note(area, message)`: one plain sentence, shown under
      Settings → Health → “Fixed on its own” as reassurance, never as an error
      or a toast that demands attention.
    - **Ask only what matters.**
      - Ask about spending, sending, publishing or deleting; about changes that
        grant trust or reach; and about credentials, which the person types
        themselves and the agent never sees.
      - Ask for things only a person can do: sign in, solve a captcha, run a
        command as administrator.
      - Ask once, in the flow, in plain words, with one obvious button. Never
        ask something Conch could have worked out or fixed itself.
    - **Never a dead end.** Every problem state says what happened in one sentence
      and offers one next step: Repair, Try again or Open settings. When only the
      person can do it (a system library on Linux), show the exact command to
      copy. A subsystem with state exposes its health and a single **Repair**
      that tries every fix in turn. The destructive fix (wiping a profile) comes
      last, and only after confirmation.
    - **Errors are for the agent too.** Tool errors say what happened and what to
      try next, in words a model can act on ("something is covering that button;
      close the dialog first"). The agent's prompt tells it to try once more
      another way before it tells the person.
    - **Test the healing, not just the happy path.** Every self-repair gets a test:
      the stale lock, the crash, the fallback, the retry.

12. **Every new part joins the features that cover all of Conch.** Some features
    are about everything Conch is: **Repair everything** looks at every part,
    **backups** carry every file you’d miss, **updates** watch every program
    Conch relies on, **connect-from-chat** knows every app in the catalog, and
    **offline and limits** route around every provider. They only stay whole if
    each new part plugs itself in — in the same change, without being asked:

    | You’re adding…                                                                                                                 | Also, in the same change                                                                                                                                                                                                                                                                                                                                                                                        |
    | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | Anything with state that can go wrong (a service, a connection, a store, a daemon)                                             | A `DoctorCheck` in `apps/server/src/doctor/checks.ts` (`registerCoreChecks`), or the subsystem's own `doctor.ts` registered from `Services`. With `repair: false` it only looks; with `repair: true` it applies the safe fixes and says `fixed`. What only a person can do is `needs-you` with one `action` (`open` a settings place, `need` to install, or a `command` to copy). Tested like `checks.test.ts`. |
    | A file or folder under `CONCH_HOME`                                                                                            | A rule in `apps/server/src/backup/manifest.ts` (ADR 0020): `kept` (with its group), `secret` (only in a passphrase-locked backup), `derived` (rebuilt, never backed up) or `outside`. `manifest.test.ts` fails on any file no rule covers.                                                                                                                                                                      |
    | A setting that lets Conch act without asking, or lets someone else reach it (a trust level, a bot's people, a program it runs) | A line in `apps/server/src/backup/powers.ts` (and a `BackupPower` kind): a restore preview names it, so an old or someone else's backup can't quietly bring it back.                                                                                                                                                                                                                                            |
    | A program, app or runtime Conch runs or relies on                                                                              | A need in `apps/server/src/setup/known.ts` (ADR 0016) with `version` (how to read the installed one), `latest` (where the newest is announced) and its `update` recipe — `updatable({ winget, brew, npm })` gives all three. Updates (ADR 0019) then watches it and offers the one-click update; `latest.test.ts` fails on a need that can update but can't say its versions.                                   |
    | An app in the integrations catalog                                                                                             | Its `cues` in `integrations/catalog.ts` (ADR 0021; the type requires them): the precise phrases that only mean that app, and the ones that mean something else, with rows in `cues.test.ts`. A false offer is worse than none; `{ match: [] }` is allowed and honest.                                                                                                                                           |
    | A provider                                                                                                                     | `Engine.local = true` if it runs on this computer (offline answers: ADR 0023, and ADR 0022 for how Ollama does it). Its failures classified as a `TurnProblem` (`limit`, `unavailable`, `signed-out`…) so a limit or an outage routes to your fallback instead of a dead end. Its readiness shows in `providersCheck`.                                                                                          |
    | A failure another provider could answer                                                                                        | `ConversationManager.#answer`'s retry condition and `Services.route` (ADR 0023). Not a failure the person must fix (`signed-out`, `key-locked`): that keeps its own card.                                                                                                                                                                                                                                       |
    | Something a person can open or do by name                                                                                      | Working agreement 10 (⌘K).                                                                                                                                                                                                                                                                                                                                                                                      |

    Three of these are enforced by tests that fail with the fix in their message
    (`backup/manifest.test.ts` — whose session really uses every store, so extend
    `test/session.ts` when you add one — `updates/latest.test.ts`, and the catalog's
    type for `cues`); the rest are on you. If a new part fits no row but is still something
    you’d want back on a new computer, or would want to know is broken, it belongs
    in one of these features: extend the feature (and this table) rather than
    leave the part out.

## Security engineering

For authenticated reverse proxies, follow [docs/REVERSE_PROXY.md](./docs/REVERSE_PROXY.md).
Keep deployment hostnames in configuration, preserve Host/Origin for HTTP and WS,
and serve built assets through the gateway so document security headers apply.

Conch runs commands **as the user**, and a prompt-injected agent is part of the
threat model. Hold every change to the bar of a FAANG security review:

1. **Research before you build.** For anything touching auth, sessions, crypto,
   parsing untrusted input, the agent's powers, or network exposure, read the
   current primary sources first:
   - OWASP ASVS 5.0 and the OWASP Cheat Sheets (Authentication, Session
     Management, Password Storage, CSRF, CSP);
   - NIST SP 800-63B-4;
   - the Fetch Metadata / resource-isolation guidance;
   - recent academic work on LLM agents, for example indirect prompt injection
     (Greshake et al., 2023), markdown/image exfiltration and tool-use escalation.

   Cite what you followed in the commit message or ADR. When the sources disagree
   or have moved on, follow the newest standard and say so.

2. **Threat-model the change.** Ask who can reach it: a web page, another
   localhost port, the LAN, a proxy, another OS user, or the agent itself.
   Loopback alone is not trust (proxies), hostname alone is not origin (ports), and
   the agent's own tool calls are untrusted input.
3. **Never roll your own crypto.** Use `node:crypto` (CSPRNG, scrypt,
   `timingSafeEqual`) and reuse `apps/server/src/auth/secrets.ts`. Store hashes of
   secrets, never the secrets. Compare in constant time.
4. **Secure by default, safe to misconfigure.** New features start locked down.
   An unsafe choice must be explicit, explained in plain words, and surfaced by the
   security checkup (`auth/checkup.ts`). Add a check whenever you add a risky
   option.
5. **Secrets never travel in URLs** (fragments only for one-time codes), logs,
   error messages, the agent's environment, or responses after creation. Show a
   secret once.
6. **Validate at every edge.** Zod on both sides, `Id`/`CommandName` for anything
   that becomes a path, and `safeJoin` for every file path.
7. **The agent can't raise its own privileges.** Anything that grants trust,
   enables automation, or persists permissions needs a human action in the UI.
   Checks that must hold in every permission mode (protected paths, tools
   turned off, the guard after reading) go in `TurnInput.guard` — Claude
   Code's PreToolUse hook — never only in `canUseTool`, which the SDK skips
   when a mode allows by itself (ADR 0028). A new tool that brings outside
   content in taints the chat (`conversations/taint.ts` `taintFrom`); one that
   can send things out or change the computer is a sink (`sinkReason`).
8. **Test the attack, not just the feature.** Add regression tests for each abuse
   case (traversal, cross-origin, replay, brute force, escalation). See
   `apps/server/src/auth/auth.test.ts` and `e2e/security.spec.ts`.
9. **Warn people in their words.** Every security message says what could happen
   and what to do next, never jargon alone.

## Secrets in a new feature

A feature that needs a key or a password never keeps it in its own file in the
clear (ADR 0025):

- **A key Conch itself uses** (a provider, an integration, a channel) goes in
  one of the sealed key files (`lib/sealed.ts` `SEALED_FILES`; add yours
  there and to the backup manifest as `secret`), and is listed in
  `Services.#systemKeys` so it shows in Passwords.
- **A secret the person owns** (a login, a card, a note) lives in Passwords.
  The agent reaches it only through `passwords_find`, `passwords_request`,
  `passwords_read` and the browser fill.
- Add any new place secrets live to `lib/protect.ts`, so the agent's own
  file tools can't touch it.

## Adding a password manager

Passwords shows Conch's own vault and the password managers people already use,
as one list (ADR 0025). A new one must play by the same rules as 1Password,
Bitwarden, KeePassXC, Proton Pass, Dashlane, Keeper and the macOS Keychain:

1. **A `PasswordSource`** in `apps/server/src/vault/sources.ts`, registered in
   `VaultService`, with an id added to `VaultSourceId` and its id prefix in
   `PREFIXES` (`service.ts`):
   - `state()` is cheap and never prompts anybody.
   - `list()` carries **no secret values**: names, accounts, sites, kinds and
     where an item sits in its own app. If the program's list includes
     passwords (Bitwarden's does), drop them while mapping.
   - `fields()` describes fields, with values only for fields that aren't
     concealed.
   - `value()` and `totp()` fetch one value for one use. It's never cached
     beyond the call, and never written anywhere. When a manager hands over
     a code's setup rather than the code, compute the code in the gateway
     (`totpNow`) instead of putting the setup anywhere.
   - `full()` (optional, for Moving in) reads every value of one item in one
     call, passkeys included when the program has their private keys. Run
     everything through `toPasskey`, which keeps only real ES256 keys.
   - A program that would stop at a prompt gets `input: ''`, so it fails in
     words instead of hanging. One that asks the person something itself
     (Touch ID, the keychain's dialog) goes in `PROMPTS`, so its copies only
     sync while someone's looking at Passwords.
2. **Through its own program and its own unlock.**
   - The program is a need (ADR 0016) in `setup/known.ts`, so Conch can find,
     install or link to it.
   - A master password or session key goes on stdin or in the program's own
     environment variable, **never as an argument**, and is kept in memory
     only.
   - The `Exec` seam lets a test pretend to be the program.
3. **Read-only.** Edits happen in the manager's own app. Items come into
   Conch's vault only when the person imports a file or chooses **Copy into
   Conch** (`vault/transfer.ts`: one way, one item at a time, through the
   program, never an export file on disk).
4. **Ids are id-safe** (`xx_…`, at most 128 characters of `[A-Za-z0-9_-]`) and
   map back to the item without guessing.
5. **Reads and fills follow the vault's rules unchanged** (`readPolicy`, `fillPolicy`, an Unlock card when locked): only on the item's own sites
   (`siteMatches`), with the person's OK, recorded and redacted. A source never
   bypasses `VaultService.fillPolicy`.
6. **Words and pictures:** its mark in Nacre's `brands.ts` (Simple Icons) and
   `SOURCE_*` in `patterns/Passwords`, its name in the web filters, and a
   one-line unlock explanation in `SourcesDialog`.
7. **Tests:** a fake program in `vault.test.ts` or `sources.test.ts`, written
   from the program's own source or docs, proving:
   - no secret reaches a list or an argument;
   - locking hides its items;
   - a fill on another site is refused;
   - copying it into Conch brings what it should.

## Adding a channel

Channels are chat apps your assistant can be reached from (ADR 0018). More are
coming, and each one follows the same shape:

1. **Outbound only.** Connect from this computer (long polling, a WebSocket
   the app offers). Never require a public address, webhook or tunnel. An app
   that only offers webhooks waits.
2. **An adapter.** Put it in `apps/server/src/channels/<app>.ts`, implementing `ChannelAdapter`:
   - `identify()` checks the keys with a real call and says who the bot is.
   - `connect()` runs and reconnects by itself, and reports `state`. It ends
     on `needs-token` only when the app refuses the key.
   - Map every error to a plain `ChannelError`, turning the app's own error
     codes into the setting to change.
   - Never put a key in a message or a URL you log (`redact`).
   - Private chats only. One channel's failure never reaches another.
3. **A pretend app** in `channels/mock/<app>.ts`, with `/__control/…` endpoints.
   Unit tests, e2e and `pnpm dev:mock` use it. Test the healing paths: a
   dropped connection, a refused key, a rate limit, and the app's own quirks.
4. **The words and pictures**: a `CHANNEL_CATALOG` entry, the logo in Nacre's
   `brands.ts` (Simple Icons; keep a brand's own colours when its rules ask),
   and a setup in `ConnectChannel.tsx`:
   - numbered steps that say which button to press;
   - beside them, a `Handset` for a chat or a `PortalSketch` for a web page;
   - everything worked out for the person that can be: names, settings, links;
   - keys accepted when pasted anywhere on the page, and checked as they land;
   - a last step, a hello that recognises the owner.
5. **Nobody gets in by default.** Only two things admit anyone: the owner's
   hello (a one-time code, or **That's me** in Conch), or a person pressing
   **Let in**.

## Definition of done

- [ ] `pnpm check` passes
- [ ] New/changed UI has stories covering its states, and screenshots were reviewed
- [ ] New behaviour has tests (unit for logic, play/axe for components)
- [ ] Docs updated where behaviour or architecture changed (this file, ARCHITECTURE.md, NACRE.md, an ADR)
- [ ] Security-relevant? Threat-modelled, abuse cases tested, checkup updated, sources cited
- [ ] Never asks anyone to type a file or folder path. Find it first (as `vault/keepass.ts` finds KeePassXC databases), offer it with Nacre `PathPicker`, and use the system's Open dialog (`POST /api/pick`, a new `PickPurpose` per use) for anything else. Typing is only the fallback from another device.
- [ ] Fails well (working agreement 11)? Foreseeable failures heal themselves or end in one plain next step, and the healing paths are tested
- [ ] Needs something outside Conch? It's declared as a need that Conch finds, installs or links to, and notices when it arrives. It's never a “Couldn't find X” message.
- [ ] Joined the whole-Conch features (working agreement 12)? A Repair everything check, a backup rule for new files, `version`/`latest` for new programs, `cues` for new catalog apps, `local` and `TurnProblem` for new providers.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
