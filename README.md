<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/pearl-dark.svg">
    <img src=".github/assets/pearl-light.svg" alt="" width="360">
  </picture>
</p>

<h1 align="center">Conch</h1>

<p align="center">
  <b>The AI agent that just works. Let it solve your problems.</b>
</p>

<p align="center">
  Every model you pay for, in one calm app on your own computer.<br>
  It sets itself up, fixes what breaks, and asks you only when it matters.
</p>

<p align="center">
  <a href="https://github.com/georgevibing/conch-agent/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/georgevibing/conch-agent/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-b9a7c4.svg"></a>
  <img alt="Runs on macOS, Windows and Linux" src="https://img.shields.io/badge/runs_on-macOS_%C2%B7_Windows_%C2%B7_Linux-d9a48f.svg">
  <img alt="No account, no telemetry" src="https://img.shields.io/badge/account-none_needed-8fb8c9.svg">
</p>

<p align="center">
  <a href="#install"><b>Install</b></a>
  &nbsp;·&nbsp;
  <a href="#what-it-does"><b>What it does</b></a>
  &nbsp;·&nbsp;
  <a href="./apps/docs/content/start/first-chat.md"><b>Your first chat</b></a>
  &nbsp;·&nbsp;
  <a href="./apps/docs/content"><b>Documentation</b></a>
  &nbsp;·&nbsp;
  <a href="./CONTRIBUTING.md"><b>Contributing</b></a>
</p>

<br>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/showcase-dark.png">
    <img src=".github/assets/showcase-light.png" alt="Conch on a computer and a phone: the assistant reads the calendar and mail, then lays out Thursday and what to get ready for it">
  </picture>
</p>

Download it, open it, sign in with a subscription or paste a key. That's the setup.
No account, no terminal, no telemetry. Your chats, memories and settings stay in
`~/.conch` on your computer, and one assistant reaches you on the web, your phone,
your desktop and the chat apps you already use.

## What it does

### Talk to any model

- **Every provider, one picker.** Claude Code, Codex, GitHub Copilot, Gemini CLI and
  Grok with your own sign-in; Ollama, LM Studio or a server of your own; keys from
  OpenRouter, Anthropic, OpenAI, Google, Mistral, DeepSeek and more. A chat can switch
  models without losing its thread. [Providers](./apps/docs/content/providers)
- **`/` commands that work everywhere.** Autocomplete for commands and their choices,
  on a phone too: `/clear` (with Undo), `/goal`, `/plan` and the rest, with every
  provider and in every chat app. [Slash commands](./apps/docs/content/reference/slash-commands.md)
- **A chat list that stays tidy.** Pin, file into folders (hold to drag on a phone),
  start a chat inside a folder, and see which chats need you. Your apps sit on top
  under **Apps**, with a folder for the rest. [Your chats](./apps/docs/content/features/chats.md)
- **It says what it's doing, in plain words.** Instead of a wall of commands, each run
  of work is one line, like "Ran the tests · 241 passed", that opens into its steps
  and then the exact calls. Ask **Why?** about any step, and see what each reply
  changed, with Undo. [Your chats](./apps/docs/content/features/chats.md)
- **It doesn't give up at the first error.** Every model reads what went wrong, tries
  another way and checks its work before it says done. [How Conch works on a problem](./apps/docs/content/features/working-on-a-problem.md)
- **Long jobs that finish.** Long chats summarise their start, caching keeps costs
  down, and each reply says what it cost. [What it costs](./apps/docs/content/care/what-it-costs.md)

### Agents

- **As many agents as you like.** Give each a name, a face (one of 18, your own
  picture, or one drawn by AI), a personality and instructions. Pick who answers a
  chat, switch mid-chat, or set one per chat app and routine; replies say who's
  speaking. [Agents](./apps/docs/content/features/agents.md)
- **Agents that talk to each other.** "@Researcher find options, @Writer draft it":
  agents take turns in one chat, with a live picture of who's talking to whom, and
  stop by themselves before they loop or run up a bill. Add agents elsewhere by
  pasting their address (A2A), and let other agents talk to yours, in words only,
  once you let them in. [Several agents in one chat](./apps/docs/content/features/agents.md#several-agents-in-one-chat)
- **Work in the background.** Hand a job off and keep chatting, or have another
  provider do a part ("have Codex write the tests"). Every provider runs it as a
  Conch task you can see, answer and stop, with its chat's permissions and never
  more. Tasks check for a saved answer or the tool receipts set before work starts, with recorded results you can inspect. [Hand it off](./apps/docs/content/features/tasks.md)
- **Memory that looks after itself.** Conch learns what will still matter from a chat
  and tidies its memories quietly. They're Markdown you can read, edit or forget. A
  memory a web page tries to plant is held and asked about. [Memory](./apps/docs/content/features/memory.md)
- **Skills.** Agent Skills (`SKILL.md`) for every model, from what worked, from a
  sentence, or from **Discover**. [Skills](./apps/docs/content/features/skills.md)
- **Bring your things.** Memories, skills, routines and agents from OpenClaw or
  Hermes, shown first and undoable for a week.

### Works for you

- **Routines.** Every weekday at 7:30, or when an email arrives, before a meeting,
  when a page changes. [Routines](./apps/docs/content/features/routines.md)
- **A browser you can watch** and take over, and a real terminal a keystroke away.
  [Browser](./apps/docs/content/features/browser.md) ·
  [Terminal](./apps/docs/content/features/terminal.md)
- **Research, files and pictures.** Sources with references, PDF and Office files
  read and made (PDF, Word, Excel, CSV, PowerPoint, charts) with any chat model and
  sent to your chat apps, pictures from any chat model, and charts and documents
  that open beside the chat.

### Apps and integrations

- **One gallery for every model.** Gmail, Google Calendar and Drive, Slack, GitHub,
  Notion, Linear and more. Add as many Google accounts as you like and choose Off,
  Read or Read & write for each product; every change asks first.
  [Apps](./apps/docs/content/features/apps.md)
- **Apps it makes for you.** Ask for an ability it doesn't have and Conch builds a
  Conch app: tools every model can use and pages that look like Conch, sealed off
  from your files. Added when you say so, shared on GitHub in one press.
  [Make apps](./apps/docs/content/features/make-apps.md)
- **Your other tools.** Claude Desktop, Cursor and VS Code can use your memory,
  skills, apps and browser, each only what you tick. [Other apps](./apps/docs/content/features/other-apps.md)

### Everywhere

- **Web and desktop.** An app for macOS, Windows and Linux, with the pearl in the
  menu bar, one-press updates and "Hey Conch" if you turn it on.
- **Your phone.** An installable app over a private Tailscale address, with
  notifications and voice. Add it from **Settings → Devices**. [On your phone](./apps/docs/content/start/phone.md)
- **Your chat apps.** Telegram, Discord, Slack, WhatsApp, Signal, iMessage, email,
  Teams, Google Chat, Matrix and more, with the same commands as the app.
  [Chat apps](./apps/docs/content/channels)
- **A server of your own.** One line installs it at `conch.yourname.com` with its own
  certificate. [On a server](./apps/docs/content/start/server.md)

### Safe by design

- **Five permission modes, the same on every provider.** **Plan only**, **Ask first**,
  **Edit freely**, **Auto** (gets on with it and stops for anything serious) and
  **Full trust**. [Permission modes](./apps/docs/content/reference/modes.md)
- **Careful after reading.** Once a chat has read a web page or an email, anything
  risky asks first. Commands run sealed off from your keys.
- **See it, undo it.** **Activity** shows everything the assistant did; **Undo** puts
  files back. [Undo](./apps/docs/content/care/undo.md)
- **It fixes itself.** **Repair everything** checks every part of Conch, with daily
  backups and signed updates that roll back on failure. **Settings → This computer**
  shows the machine live, and what each provider uses. [Health](./apps/docs/content/care/health.md)
- **Sign in with your device.** Touch ID, Windows Hello or Face ID; a new device waits
  for your OK in **Settings → Devices**.

## Good to know

- **It runs as you.** Conch can read your files and run commands. Treat it like an
  SSH server and read [docs/SECURITY.md](./docs/SECURITY.md) before you put it on a
  network. Out of the box only this computer can open it.
- **Local models are smaller.** A model on your computer is free and private, but
  slower and less capable than the cloud ones.
- **Conch is free.** The models cost what your plan or key costs.

## Install

**Download the app** for macOS, Windows or Linux from the
[latest release](https://github.com/georgevibing/conch-agent/releases/latest) and
open it. If your computer asks first,
[the guide](./apps/docs/content/start/app.md#if-your-computer-asks-first) says which
button to press.

Or one line in a terminal. macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/georgevibing/conch-agent/main/scripts/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/georgevibing/conch-agent/main/scripts/install.ps1 | iex
```

It gets Node.js and Git if they're missing, keeps Conch running and opens it. Run it
again to update, add `--uninstall` to remove it, or `--server` on a computer with no
screen ([On a server](./apps/docs/content/start/server.md)). Afterwards, `conch help`
lists what the command line can do.

From a checkout (Node 24 or newer):

```bash
corepack enable
pnpm install
pnpm start        # builds and opens http://localhost:4317
```

## Documentation

[conchagent.com/docs](https://conchagent.com/docs/) covers every provider, chat app
and feature, with a reference read from the code.
[Development docs](https://conchagent.com/docs/next/) follow `main`, and
[release notes](https://conchagent.com/releases/) list every version. Locally,
`pnpm docs:dev` serves them at http://localhost:4400.

How it's built: [ARCHITECTURE.md](./ARCHITECTURE.md) ·
[decisions](./docs/adr) · [AGENTS.md](./AGENTS.md) (for people and coding agents).

## Development

```bash
pnpm dev          # web app on :5173 (hot reload) + gateway on :4317
pnpm dev:mock     # the same with a scripted provider: no model usage
pnpm storybook    # the Nacre design system on :6006
pnpm check        # format, lint, types and tests: must pass before every commit
pnpm e2e          # Playwright journeys
pnpm desktop:dev  # the desktop app, with hot reload
```

| Path                | What                                                       |
| ------------------- | ---------------------------------------------------------- |
| `apps/web`          | React 19 + Vite web app                                    |
| `apps/server`       | Fastify gateway: providers, apps, browser, terminal, chats |
| `apps/docs`         | The documentation site                                     |
| `apps/desktop`      | The Electron app                                           |
| `packages/nacre`    | Nacre, Conch's design system                               |
| `packages/protocol` | Zod schemas for everything the app and gateway say         |
| `e2e`               | Playwright journeys                                        |

Configuration comes from the environment: [apps/server/.env.example](./apps/server/.env.example).

## Contributing, security, license

Issues and pull requests are welcome: start with [CONTRIBUTING.md](./CONTRIBUTING.md)
and the [code of conduct](./CODE_OF_CONDUCT.md). Report a vulnerability through
[SECURITY.md](./SECURITY.md), not an issue. [MIT](./LICENSE) licensed; third-party
notices in [NOTICE.md](./NOTICE.md).

<br>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/pearl-dark.svg">
    <img src=".github/assets/pearl-light.svg" alt="" width="140">
  </picture>
</p>
