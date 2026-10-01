# Conch

**A calm, beautiful home for the AI assistants of your choosing — running on your
own computer.**

Conch is a small gateway that runs on your machine and a polished web app that
talks to it, from your laptop, your tablet or your phone. It drives every provider
you connect at once — Claude Code, Codex, a model on this computer, OpenRouter or
the Anthropic API — from one model picker, and a conversation can move between them
without losing its thread. Your files, your sign-ins and your settings stay on your
computer, as plain files in `~/.conch`.

> _Why "Conch"?_ A conch is a shell — and your assistant lives in yours. In the old
> story, whoever holds the conch gets to speak.

**The Conch promise.** Anyone can use it, including people who have never opened a
terminal. Conch sets itself up, fixes what breaks before anyone notices, and
interrupts only to ask for approval of something that matters, or for the one thing
only a person can do.

The UI is built on **Nacre**, Conch's own design system: opaque "glazed porcelain"
surfaces with a pointer-reactive, mother-of-pearl iridescence we call _Lustre_.

## Quick start

One line, nothing else to install first:

```bash
curl -fsSL https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.ps1 | iex
```

It gets Node.js and Git if you don't have them (into Conch's own folder, checked
against their checksums, no administrator), builds Conch, keeps it running in the
background, adds **Conch** to your apps and opens it. Then Conch looks for what you
already have, helps you connect a provider (and sign in, or install what's missing),
and asks a couple of optional questions so it can be _yours_. Run the line again to
update; add `--uninstall` to remove it. For a computer that stays on (a Mac mini, a
Raspberry Pi), add `--server`: no browser, it keeps running after you log out, and it
prints your phone's secure address and a QR code to sign the phone in.

From a checkout instead (Node ≥ 24):

```bash
corepack enable     # or: npm i -g pnpm
pnpm install
pnpm start          # builds the app and opens http://localhost:4317
```

**On your phone, safely:** choose a password in **Settings → Security**, press **Add a
device**, and Conch sets up an encrypted address for your phone over Tailscale with
one press, then shows a QR code to scan. Add Conch to your Home Screen and it's an app,
with notifications. [docs/SECURITY.md](./docs/SECURITY.md) explains it in
two minutes (Tailscale recommended; `pnpm conch reset` if you forget). For a second
lock, turn on **Approve new devices**: a new device then waits, even with the right
password, until you run `pnpm conch devices approve` on your computer. Or skip the
browser entirely and reach your assistant from Telegram, Discord or Slack.

## What it does

**Every provider at once.** Claude Code (through the Claude Agent SDK, with your
existing `~/.claude`, `CLAUDE.md`, MCP servers and hooks), the Codex CLI, OpenRouter,
the Anthropic API, and **On this computer** — an Ollama model that is private, free
and works offline. Keys can live in 1Password instead of a dotfile.
([ADR 0010](./docs/adr/0010-providers.md), [0012](./docs/adr/0012-every-provider-at-once.md),
[0022](./docs/adr/0022-a-model-on-this-computer.md))

**Offline and at a limit, it carries on.** A message sent offline waits and goes by
itself, or the model on this computer answers. At a usage limit, the provider you
picked takes over. ([ADR 0023](./docs/adr/0023-offline-and-limits.md))

**It remembers, in the open.** Memories are small Markdown files you can read, edit
or delete; every save shows in the chat with Undo. Search finds any line in months
of chats, typos and all. ([ADR 0003](./docs/adr/0003-memory.md),
[0007](./docs/adr/0007-search.md))

**It learns you — visibly.** Memory search understands meaning with a model on
this computer (or forgives typos without one), and the prompt carries the
memories that matter. Turn on **Tidy up every night** and Conch merges repeats,
updates what changed and learns from your chats while you sleep: every change is
a card with Undo. Something you've asked for in three chats is offered as a skill,
drafted for you to read; it's never saved by itself. Anything learned in a chat
that read a web page or an email waits for your OK. **What Conch knows about you**
shows it all, searchable and exportable. ([ADR 0032](./docs/adr/0032-it-learns-you.md))

**Apps, skills and routines — for every provider.** Connect Notion, Gmail, Google
Calendar and Drive, Slack, GitHub, Linear, Atlassian, Home Assistant, Stripe and
more from a gallery, no JSON editing; Conch keeps their sign-ins fresh, and offers
to connect one when you ask about it in a chat. Agent Skills (`SKILL.md`) and your
own commands work with every model. Routines run tasks on a schedule you read in
plain words, and nothing runs until you turn it on.
([ADR 0009](./docs/adr/0009-integrations.md), [0013](./docs/adr/0013-skills.md),
[0006](./docs/adr/0006-routines.md), [0021](./docs/adr/0021-connect-from-chat.md))

**It can use the web for you.** Conch has a browser of its own, with nothing to
install. You watch it work live beside the chat and can take the wheel at any time.
It asks before it acts on a new site and hands you the keyboard for passwords, which
it never sees. See [docs/BROWSER.md](./docs/BROWSER.md).

**A terminal, a keystroke away.** <kbd>Ctrl</kbd> + <kbd>`</kbd> opens a real shell on
the computer Conch runs on. "Run in terminal" on the assistant's commands types them
in for you to check. Other devices can't open one unless you allow it. See
[docs/TERMINAL.md](./docs/TERMINAL.md).

**Files, pictures and long pastes.** Drop or paste them into the composer; long
pastes fold into a card, and each provider gets them in the way it can use.
([ADR 0017](./docs/adr/0017-attachments.md))

**Reach it from your chat apps.** Connect Telegram, Discord or Slack in a few guided
steps — no public address or tunnel — and approve what the assistant asks right
there. Nobody gets in unless you let them. ([ADR 0018](./docs/adr/0018-channels.md))

**In your pocket.** On your phone Conch is an app, with no app store needed.
Notifications tell you when it needs your OK, with Deny right there; when an answer
is ready while you're away; and when a routine has run. They never come while you're
looking at Conch. Dictate into any message, have answers read aloud, or talk hands
free. Your voice can stay on your own devices: on the phone itself, or on the
computer Conch runs on. ([ADR 0027](./docs/adr/0027-in-your-pocket.md))

**Always on, and an app of its own.** Conch starts when you log in and keeps
running with no window, so routines run on time and your phone and chat apps can
always reach it. Turning it on from a Terminal window moves Conch to the background
without losing your place. Open **Conch** from Applications, Spotlight or the Start
menu, and it starts itself first if it has to. ([ADR 0026](./docs/adr/0026-always-on.md))

**In the menu bar.** The pearl in the menu bar (the tray on Windows, the panel on
Linux) says whether Conch is running, shows a dot when something needs you, and opens,
starts or quits Conch in one click. On a computer that stays on, Conch keeps running
after you log out (Linux) and can keep a Mac awake.
([ADR 0029](./docs/adr/0029-menu-bar-and-little-computer.md))

**Safe hands.** Once a chat has read a web page, an email or someone else's message,
anything that could send your things out or change your computer asks you first,
in every mode, and says why. Commands run sealed, so they can't read your keys or
saved passwords. **Activity** shows everything your assistant did. Skills are read
through before they're used: a worrying one stays off until you've looked, and
another app's skill that changes turns off again. ([ADR 0028](./docs/adr/0028-safe-hands.md))

**Undo.** Every file your assistant makes, changes or deletes can be put back, from
the chat or from Activity, whichever provider did it. You see exactly what will
change first, a file you've changed since is only replaced if you say so, and
Redo puts it back again. Memories it saved can be forgotten there too.
([ADR 0030](./docs/adr/0030-undo.md))

**Come home.** Coming from OpenClaw or Hermes? Conch finds them and shows exactly
what would come over: your memories, persona and what it knows about you, skills
(read through first, and off until you turn them on), scheduled jobs (as draft
routines) and, only if you tick them, your chat bots and keys. It backs up first,
leaves the other app's folder alone, and Undo takes it all back.
`pnpm conch import --from openclaw --dry-run` shows the same list in a terminal.
([ADR 0035](./docs/adr/0035-come-home.md))

**Show me.** Ask for a chart, a page, a document, a diagram or a table, and it opens
beside the chat: every version kept, with what changed, ready to copy, download or open
full screen. Pages run sealed off, so one made after reading something hostile still
can't reach your things or the internet. Pin one as an app in the sidebar, and refresh
it with fresh data whenever you like. ([ADR 0034](./docs/adr/0034-show-me.md))

**Hand it off.** Press ⌘⇧↩ to send something to the background and keep chatting:
a live card shows what it's doing, **Tasks** shows everything that's working, and
its result comes back to your chat, with a notification when it's done. The
assistant can split a job and run the parts side by side on a faster model, each
in its own copy of the folder if it's code. Helpers ask as you would, stay as
careful as their chat, and stop when you stop. ([ADR 0033](./docs/adr/0033-hand-it-off.md))

**It looks after itself.** **Settings → Health** has one **Repair everything**
button, a quiet list of what Conch fixed on its own, daily backups you can restore
(with a preview and Undo), and one-click updates for Conch and the programs it uses.
Conch restarts itself after a crash. ([ADR 0016](./docs/adr/0016-getting-what-a-feature-needs.md),
[0019](./docs/adr/0019-updates.md), [0020](./docs/adr/0020-backups.md))

**One box for everything.** <kbd>⌘</kbd> + <kbd>K</kbd> finds chats and messages,
models, skills, apps, routines, pages and settings by name.

## Development

```bash
pnpm dev            # web on :5173 (hot reload) + gateway on :4317
pnpm dev:mock       # same, with a scripted engine and pretend apps — no model usage
pnpm storybook      # explore Nacre at http://localhost:6006
pnpm check          # format + lint + typecheck + tests — must pass before every commit
pnpm e2e            # Playwright journeys against the gateway and the mock engine
pnpm start:network  # reachable from your network (sign-in required)
pnpm conch help     # sign-in from the terminal: status, password, key, pair, reset …
pnpm conch import --from openclaw --dry-run   # what would come over from OpenClaw (or hermes)
```

Configuration comes from the environment; [apps/server/.env.example](./apps/server/.env.example)
documents it. For an authenticated HTTPS reverse proxy, see
[docs/REVERSE_PROXY.md](./docs/REVERSE_PROXY.md).

## Layout

| Path                | What                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `apps/web`          | React 19 + Vite web app                                                  |
| `apps/server`       | Fastify gateway: providers, integrations, browser, terminal, channels, … |
| `packages/nacre`    | Design system + Storybook                                                |
| `packages/protocol` | Zod-validated wire protocol                                              |
| `e2e`               | Playwright journeys                                                      |

## Docs

- [AGENTS.md](./AGENTS.md) — how to work in this repo (humans and AI agents)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design and security model
- [docs/SECURITY.md](./docs/SECURITY.md) — signing in, phones, recovery, warnings
- [docs/BROWSER.md](./docs/BROWSER.md) — the browser: watching, taking over, what it asks
- [docs/TERMINAL.md](./docs/TERMINAL.md) — the terminal: shortcuts, the assistant, other devices
- [docs/design/NACRE.md](./docs/design/NACRE.md) — the design language
- [docs/adr](./docs/adr) — decision records (0001–0035)
