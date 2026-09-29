# AGENTS.md

Operating manual for AI coding agents (and humans) working in **Conch**. Read this
first, then follow the routing table to the one document that covers your task.
Nested `AGENTS.md` files override this one for their subtree.

## What Conch is

A self-hosted web facade for [Claude Code](https://code.claude.com). A small Node
gateway runs on the machine where Claude Code lives, drives it through the Claude
Agent SDK, and streams the conversation to a React web app built on **Nacre**, our
own design system. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Routing — where to go for what

| If your task involves…                                    | Read / work in                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Any UI component, token, animation, theming, Storybook    | [`packages/nacre/AGENTS.md`](./packages/nacre/AGENTS.md) → [`docs/design/NACRE.md`](./docs/design/NACRE.md) |
| The web app (routes, state, data fetching, chat screens)  | `apps/web/` + [ARCHITECTURE.md § Web app](./ARCHITECTURE.md#web-app-appsweb)                                |
| The gateway / Claude Code integration / permissions       | `apps/server/` + [ARCHITECTURE.md § Gateway](./ARCHITECTURE.md#gateway-appsserver)                          |
| Wire protocol between web and gateway                     | `packages/protocol/` + [ARCHITECTURE.md § Protocol](./ARCHITECTURE.md#wire-protocol-packagesprotocol)       |
| Lint / TS config shared across packages                   | `packages/eslint-config/`, `packages/tsconfig/`                                                             |
| A decision that changes architecture or adds a dependency | Write an ADR in [`docs/adr/`](./docs/adr/) first                                                            |
| Security, auth, exposing the gateway beyond localhost     | [ARCHITECTURE.md § Security](./ARCHITECTURE.md#security-model) — treat as high-risk                         |

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

| Command                                                                     | What it does                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm install`                                                              | Install everything                                                          |
| `pnpm dev`                                                                  | Run all dev servers via Turbo                                               |
| `pnpm storybook`                                                            | Nacre Storybook on http://localhost:6006                                    |
| `pnpm check`                                                                | Format check + lint + typecheck + tests. **Must pass before every commit.** |
| `pnpm test`                                                                 | All unit tests (Vitest)                                                     |
| `pnpm --filter @conch/nacre test -- src/components/Button`                  | Tests for one component                                                     |
| `node scripts/snap.mjs <story-id> [--mode=dark] [--hover=css] [--clip=css]` | Screenshot a story for visual QA (Storybook must be running)                |

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

## Definition of done

- [ ] `pnpm check` passes
- [ ] New/changed UI has stories covering its states, and screenshots were reviewed
- [ ] New behaviour has tests (unit for logic, play/axe for components)
- [ ] Docs updated where behaviour or architecture changed (this file, ARCHITECTURE.md, NACRE.md, an ADR)

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
