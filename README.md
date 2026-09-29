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
pnpm storybook      # explore Nacre at http://localhost:6006
pnpm dev            # web on :5173, gateway on :4317
```

Requires Node ≥ 24 and a working `claude` (Claude Code) login on the host.

## Layout

| Path                | What                                          |
| ------------------- | --------------------------------------------- |
| `apps/web`          | React 19 + Vite chat UI                       |
| `apps/server`       | Fastify gateway wrapping the Claude Agent SDK |
| `packages/nacre`    | Design system + Storybook                     |
| `packages/protocol` | Zod-validated wire protocol                   |

## Docs

- [AGENTS.md](./AGENTS.md) — how to work in this repo (humans and AI agents)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design and security model
- [docs/design/NACRE.md](./docs/design/NACRE.md) — the design language
- [docs/adr](./docs/adr) — decision records

## Status

Milestone 1: monorepo, tooling and the Nacre component library. The chat
experience is next.
