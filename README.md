# Conch

[![CI](https://github.com/georgevibing/conch-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/georgevibing/conch-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A home for the AI assistants and models of your choosing, running on your own
computer.**

Conch is a small gateway that runs on your machine and a web app you open from
your laptop, tablet or phone, or as an app on your computer. It drives every provider you connect at once, from
one model picker, and a conversation can move between them without losing its
thread. Your chats, memories and settings stay on your computer as plain files in
`~/.conch`. There's no Conch account and no telemetry.

It's made for people who have never opened a terminal: it sets itself up, repairs
what breaks, and asks only for approvals that matter.

## What it does

- **Every provider at once.** The plans you already pay for, each signed in with
  its own program (Claude Code, Codex, GitHub Copilot, Gemini CLI, Grok). A model
  on this computer (Ollama, LM Studio) or a server of your own. Keys from
  OpenRouter, Anthropic, OpenAI, Google, Mistral, DeepSeek and more.
- **Apps, skills and routines for every model.** Gmail, Google Calendar and
  Drive, Slack, GitHub, Notion, Linear and more from one gallery, plus Agent Skills
  (`SKILL.md`) and routines that run on a schedule you read in plain words.
- **Memory you can read.** Memories are Markdown files you can edit or delete,
  and search finds any line in months of chats.
- **A tidy list, nothing lost.** Archive a chat to take it out of your list
  without deleting it. It stays searchable, waits under **Archived**, and comes
  back by itself when you write in it or it needs you.
- **A browser and a terminal.** The assistant uses a browser you can watch and
  take over, and a real shell is a keystroke away.
- **Reach it from your chat apps.** Telegram, Discord, Slack, WhatsApp, Signal,
  iMessage, email, Microsoft Teams, Matrix and WeChat.
- **On your phone.** An installable app over a private Tailscale address, with
  notifications and voice.
- **A desktop app.** Conch for macOS, Windows and Linux: its own window, the
  pearl in the menu bar, and each new release one press away.
- **Safe hands.** After a chat reads a web page or an email, anything risky asks
  first. Commands run sealed off from your keys, **Activity** shows everything the
  assistant did, and **Undo** puts back the files it changed.
- **Show me.** Charts, pages and documents open beside the chat, sealed off from
  your data, with every version kept.
- **Hand it off.** Send work to the background and keep chatting.
- **Offline and at a limit.** A message waits until you're back online, or the
  model on this computer answers. At a usage limit, the provider you picked takes
  over.
- **It looks after itself.** **Repair everything**, daily backups, and signed
  releases with one-click updates that go back if something fails.
- **Bring your things.** Memories, skills and routines from OpenClaw or Hermes.
- **One box for everything.** <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> finds
  chats, models, skills, apps and settings by name.

## Install

**Download the app** for macOS, Windows or Linux from the
[latest release](https://github.com/georgevibing/conch-agent/releases/latest) and
open it. It carries everything it needs. If your computer asks before opening it
the first time, [the guide](./apps/docs/content/start/app.md#if-your-computer-asks-first)
says which button to press.

Or one line in a terminal, on macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/georgevibing/conch-agent/main/scripts/install.sh | sh
```

On Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/georgevibing/conch-agent/main/scripts/install.ps1 | iex
```

The installer gets Node.js and Git if they're missing, builds Conch, keeps it
running in the background and opens it. Conch then helps you connect a provider.
Run the same line again to update. Add `--uninstall` to remove it, or `--server`
for a computer that stays on (no browser; it prints a QR code to sign in your
phone).

From a checkout (Node 24 or newer):

```bash
corepack enable
pnpm install
pnpm start        # builds and opens http://localhost:4317
```

> **Conch runs as you.** It can read your files and run commands, so treat it like
> an SSH server. Out of the box only this computer can open it. Read
> [docs/SECURITY.md](./docs/SECURITY.md) before you put it on a network.

**On your phone:** choose a password in **Settings → Security**, press **Add a
device**, and scan the QR code. Conch sets up the private address for you.

## Documentation

`pnpm docs:dev` serves the site at http://localhost:4400: guides for every
provider, chat app and feature, plus a reference for the command line,
configuration and API that's read from the code. The sources:

- [apps/docs/content](./apps/docs/content): the guides
- [ARCHITECTURE.md](./ARCHITECTURE.md): how it's built, and the security model
- [docs/SECURITY.md](./docs/SECURITY.md): signing in, phones, recovery
- [docs/adr](./docs/adr): why things are the way they are
- [AGENTS.md](./AGENTS.md): how to work in this repo, for people and coding agents

## Development

```bash
pnpm dev          # web app on :5173 (hot reload) + gateway on :4317
pnpm dev:mock     # the same with a scripted provider and pretend apps: no model usage
pnpm storybook    # the Nacre design system on :6006
pnpm check        # format, lint, types and tests: must pass before every commit
pnpm e2e          # Playwright journeys against the gateway and the mock provider
pnpm desktop:dev  # the desktop app on the repository, with hot reload
pnpm conch help   # the command line: status, password, devices, import …
```

Configuration comes from the environment;
[apps/server/.env.example](./apps/server/.env.example) lists it.

| Path                | What                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `apps/web`          | React 19 + Vite web app                                                  |
| `apps/server`       | Fastify gateway: providers, integrations, browser, terminal, channels, … |
| `apps/docs`         | The documentation site                                                   |
| `apps/desktop`      | The Electron app for macOS, Windows and Linux                            |
| `packages/nacre`    | Nacre, Conch's design system, with Storybook                             |
| `packages/protocol` | Zod schemas for every message between the app and the gateway            |
| `e2e`               | Playwright journeys                                                      |

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md),
and please follow the [code of conduct](./CODE_OF_CONDUCT.md). To report a
vulnerability, see [SECURITY.md](./SECURITY.md) rather than opening an issue.

## License

[MIT](./LICENSE). Third-party notices are in [NOTICE.md](./NOTICE.md).
