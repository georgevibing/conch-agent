# Conch

**A calm, beautiful web facade for the Claude Code running on your own machine.**

Conch runs a small gateway next to your Claude Code install and gives you a
polished chat interface for it in the browser — from your laptop, your tablet, or
over a tunnel from anywhere. Your files, your auth, your `CLAUDE.md`, your MCP
servers: Conch just gives them a better shell.

> _Why "Conch"?_ A conch is a shell — and Claude Code lives in yours. In the old
> story, whoever holds the conch gets to speak.

The UI is built on **Nacre**, Conch's own design system: opaque "glazed porcelain"
surfaces with a pointer-reactive, mother-of-pearl iridescence we call _Lustre_.

## Quick start

```bash
corepack enable     # or: npm i -g pnpm
pnpm install
pnpm start          # builds the app and opens http://localhost:4317
```

That's it. Conch finds Claude Code on your machine, tells you if it needs installing
or signing in (and can sign you in), then asks a couple of optional questions so it
can be _yours_. Everything it stores — settings, memories, conversations — lives in
`~/.conch` as plain files.

Development:

```bash
pnpm dev            # web on :5173 (hot reload) + gateway on :4317
pnpm dev:mock       # same, with a scripted engine — no Claude usage
pnpm storybook      # explore Nacre at http://localhost:6006
```

Requires Node ≥ 24. Claude Code is optional to start — Conch will walk you through it.

**On your phone, safely:** choose a password in **Settings → Security**, then scan
the **Add a device** QR code. [docs/SECURITY.md](./docs/SECURITY.md) explains it in
two minutes (Tailscale recommended; `pnpm conch reset` if you forget).

## Layout

For an authenticated HTTPS reverse proxy, see [docs/REVERSE_PROXY.md](./docs/REVERSE_PROXY.md).

| Path                | What                                          |
| ------------------- | --------------------------------------------- |
| `apps/web`          | React 19 + Vite chat UI                       |
| `apps/server`       | Fastify gateway wrapping the Claude Agent SDK |
| `packages/nacre`    | Design system + Storybook                     |
| `packages/protocol` | Zod-validated wire protocol                   |

## Docs

- [AGENTS.md](./AGENTS.md) — how to work in this repo (humans and AI agents)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design and security model
- [docs/SECURITY.md](./docs/SECURITY.md) — signing in, phones, recovery, warnings
- [docs/design/NACRE.md](./docs/design/NACRE.md) — the design language
- [docs/adr](./docs/adr) — decision records

## Status

- ✅ Milestone 1 — monorepo, tooling, Nacre design system
- ✅ Milestone 2 — the Conch agent: onboarding, chat over Claude Code, memory,
  personality, permissions
- Next — Codex CLI, Anthropic API and OpenRouter engines
