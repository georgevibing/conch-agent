# AGENTS.md

Operating manual for AI coding agents (and humans) working in **Conch**. Read this
first, then follow the routing table to the one document that covers your task.
Nested `AGENTS.md` files override this one for their subtree.

## What Conch is

A self-hosted web shell for a coding agent of your choosing. A small Node gateway
runs on your own machine, drives the provider you connected — [Claude
Code](https://code.claude.com) through the Claude Agent SDK, another installed CLI,
or a model API — and streams the conversation to a React web app built on **Nacre**,
our own design system. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Routing — where to go for what

| If your task involves…                                    | Read / work in                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any UI component, token, animation, theming, Storybook    | [`packages/nacre/AGENTS.md`](./packages/nacre/AGENTS.md) → [`docs/design/NACRE.md`](./docs/design/NACRE.md)                                                                                       |
| The web app (routes, state, data fetching, chat screens)  | `apps/web/` + [ARCHITECTURE.md § Web app](./ARCHITECTURE.md#web-app-appsweb)                                                                                                                      |
| The gateway / Claude Code integration / permissions       | `apps/server/` + [ARCHITECTURE.md § Gateway](./ARCHITECTURE.md#gateway-appsserver)                                                                                                                |
| Wire protocol between web and gateway                     | `packages/protocol/` + [ARCHITECTURE.md § Protocol](./ARCHITECTURE.md#wire-protocol-packagesprotocol)                                                                                             |
| Lint / TS config shared across packages                   | `packages/eslint-config/`, `packages/tsconfig/`                                                                                                                                                   |
| Integrations (apps/MCP servers, OAuth, the catalog)       | `apps/server/src/integrations/` + [ADR 0009](./docs/adr/0009-integrations.md) — security-relevant                                                                                                 |
| Providers (which engine runs, connecting them, keys)      | `apps/server/src/providers/`, `apps/server/src/secrets/` + [ADR 0010](./docs/adr/0010-providers.md) — security-relevant                                                                           |
| A decision that changes architecture or adds a dependency | Write an ADR in [`docs/adr/`](./docs/adr/) first                                                                                                                                                  |
| Security, auth, exposing the gateway beyond localhost     | [§ Security engineering](#security-engineering) below → [ARCHITECTURE.md § Security](./ARCHITECTURE.md#security-model) → [ADR 0008](./docs/adr/0008-access-and-hardening.md) — treat as high-risk |

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

| Command                                                                     | What it does                                                                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                              | Install everything                                                                                   |
| `pnpm dev`                                                                  | Run all dev servers via Turbo                                                                        |
| `pnpm storybook`                                                            | Nacre Storybook on http://localhost:6006                                                             |
| `pnpm check`                                                                | Format check + lint + typecheck + tests. **Must pass before every commit.**                          |
| `pnpm test`                                                                 | All unit tests (Vitest)                                                                              |
| `pnpm e2e`                                                                  | Builds the web app and runs Playwright journeys against the gateway + mock engine                    |
| `pnpm dev:mock`                                                             | Dev servers with the scripted mock engine (no Claude usage)                                          |
| `pnpm start`                                                                | Build and run Conch for real at http://localhost:4317                                                |
| `pnpm start:network`                                                        | Same, reachable from your network (sign-in required; prefer Tailscale)                               |
| `pnpm conch <command>`                                                      | Sign-in from the terminal: `status`, `password`, `key`, `pair`, `reset` … (`pnpm conch help`)        |
| `pnpm --filter @conch/nacre test -- src/components/Button`                  | Tests for one component                                                                              |
| `pnpm a11y [--filter=button]`                                               | axe (incl. colour contrast) on every story, light + dark, in real Chrome (Storybook must be running) |
| `node scripts/snap.mjs <story-id> [--mode=dark] [--hover=css] [--clip=css]` | Screenshot a story for visual QA (Storybook must be running)                                         |

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
9. **Design for every provider, not just Claude Code.** Conch will drive other
   engines (Codex CLI, OpenRouter, the Anthropic API, local models). Every feature
   must work for all of them, or degrade on purpose:
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
8. **Test the attack, not just the feature.** Add regression tests for each abuse
   case (traversal, cross-origin, replay, brute force, escalation). See
   `apps/server/src/auth/auth.test.ts` and `e2e/security.spec.ts`.
9. **Warn people in their words.** Every security message says what could happen
   and what to do next, never jargon alone.

## Definition of done

- [ ] `pnpm check` passes
- [ ] New/changed UI has stories covering its states, and screenshots were reviewed
- [ ] New behaviour has tests (unit for logic, play/axe for components)
- [ ] Docs updated where behaviour or architecture changed (this file, ARCHITECTURE.md, NACRE.md, an ADR)
- [ ] Security-relevant? Threat-modelled, abuse cases tested, checkup updated, sources cited

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
