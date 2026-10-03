# Conch

**A calm, beautiful home for the AI assistants of your choosing — running on your
own computer.**

Conch is a small gateway that runs on your machine and a polished web app that
talks to it, from your laptop, your tablet or your phone, or as an app on your
computer. It drives every provider
you connect at once — the plans you already pay for (Claude Code, Codex, GitHub
Copilot, Gemini CLI, Grok), a model on this computer, a server of your own, or a key
from any of a dozen companies — from one model picker, and a conversation can move between them
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

**Download the app** for macOS, Windows or Linux from the
[latest release](https://github.com/giotiskl/conch-agent/releases/latest), and open it.
It carries everything it needs, keeps running in the menu bar when you close its
window, and brings each new release to you. If your computer asks before opening it the first time,
[the guide](./apps/docs/content/start/app.md#if-your-computer-asks-first) says which
button to press.

Or one line in a terminal, nothing else to install first:

```bash
curl -fsSL https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.ps1 | iex
```

It gets Node.js and Git if you don't have them, builds Conch, keeps it running in the
background, adds **Conch** to your apps and opens it. Then Conch looks for what you
already have, helps you connect a provider (and sign in, or install what's missing),
and guides you through a useful first job before optional personalization. Run the line again to
update; add `--uninstall` to remove it. For a computer that stays on (a Mac mini, a
Raspberry Pi), add `--server`: no browser, it keeps running after you log out, and it
prints your phone's secure address and a QR code to sign the phone in.

Conch runs as you. On Linux and macOS, the installer offers missing terminal build
tools before installing dependencies, showing what it will run and asking before
changing system packages. Decline, or use `--no-system-packages`, to continue
without them: full terminals can use Python 3, with basic commands as a last resort.
An unavailable native terminal backend never prevents Conch from installing.

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
browser entirely and reach your assistant from Telegram, Discord, Slack, WhatsApp, Signal,
iMessage or email.

## What it does

**Something useful first.** Turn notes into a saved brief, prepare for today from
Google email and calendar, or review follow-up drafts. Each job shows its access,
keeps progress through interruptions and links verified saved results. Personality
and import questions come afterwards. ([ADR 0039](./docs/adr/0039-first-useful-result.md))

**Every provider at once.** _Your plans_: Claude Code (through the Claude Agent SDK,
with your existing `~/.claude`, `CLAUDE.md`, MCP servers and hooks), Codex, GitHub
Copilot, Gemini CLI and Grok, each signed in with its own program, so Conch never
holds their credentials. _On this computer_: an Ollama or LM Studio model that is
private, free and works offline, or any server you run (llama.cpp, vLLM, Jan,
LiteLLM). _Pay as you go_: OpenRouter, Anthropic, OpenAI, Google Gemini, xAI,
DeepSeek, Mistral, Groq, Cerebras, Z.ai, Kimi, MiniMax, Qwen and Ollama Cloud.
Paste a key anywhere on **Settings → Providers**: Conch knows whose it is from how
it starts, or asks when it can't tell, and never tries it at the wrong company. A key
already in your environment, or a server already running, is offered in one press.
Keys can live in 1Password instead of a dotfile.
([ADR 0010](./docs/adr/0010-providers.md), [0012](./docs/adr/0012-every-provider-at-once.md),
[0022](./docs/adr/0022-a-model-on-this-computer.md), [0053](./docs/adr/0053-more-providers.md))

**Offline and at a limit, it carries on.** A message sent offline waits and goes by
itself, or the model on this computer answers. At a usage limit, the provider you
picked takes over. ([ADR 0023](./docs/adr/0023-offline-and-limits.md))

**A model that can only chat says so.** The picker marks the models that can't use
apps. Ask one about an app you connected, and the chat offers one tap to a model
you set up that can, and sends your message by itself.
([ADR 0050](./docs/adr/0050-models-that-cannot-use-apps.md))

**It remembers, in the open.** Memories are small Markdown files you can read, edit
or delete; every save shows in the chat with Undo. Search finds any line in months
of chats, typos and all. ([ADR 0003](./docs/adr/0003-memory.md),
[0007](./docs/adr/0007-search.md))

**It learns you — visibly.** Memory search understands meaning with a small model
that runs on this computer, downloaded once when you press **Get it** (and forgives
typos and knows a few everyday ideas before that), and the prompt carries the
memories that matter. Turn on **Tidy up every night** and Conch merges repeats,
updates what changed and learns from your chats while you sleep: every change is
a card with Undo. Something you've asked for in three chats, however you worded it, is offered
as a skill, drafted for you to read; it's never saved by itself. Anything learned in a chat
that read a web page or an email waits for your OK. **What Conch knows about you**
shows it all, searchable and exportable. ([ADR 0032](./docs/adr/0032-it-learns-you.md),
[0041](./docs/adr/0041-meaning-out-of-the-box.md))

**Apps, skills and routines — for every provider.** Connect Notion, Gmail, Google
Calendar and Drive, Slack, GitHub, Linear, Atlassian, Home Assistant, Stripe and
more from a gallery, no JSON editing — every one works with every model, whichever
provider answers, and what a provider set up by itself comes in on its own; Conch keeps their sign-ins fresh, and offers
to connect one when you ask about it in a chat. Agent Skills (`SKILL.md`) and your
own commands work with every model. Routines run tasks on a schedule you read in
plain words, and nothing runs until you turn it on.
Gmail, Google Calendar and Google Drive are apps like the rest, with one Google
account shared between them. Gmail connects with an app password in two steps
(reads, searches and saves drafts, never sends); Calendar and Drive use your own
Google Cloud app, which the setup guides you through, locally or on a server,
without a hosted Conch connection service.
Everything is on one page, **Apps**, one card per app: Slack that reads for you and
the Slack you message your assistant in are one card, as are Gmail and the email
address you write to, and 1Password's sign-ins and Environments. Each app's page
has plain switches for what it does (Read & search, Draft, Send (asks first), Talk
to me here), and setting up one half offers the other.
([ADR 0009](./docs/adr/0009-integrations.md), [0013](./docs/adr/0013-skills.md),
[0006](./docs/adr/0006-routines.md), [0021](./docs/adr/0021-connect-from-chat.md),
[0040](./docs/adr/0040-google-setup-without-a-broker.md),
[0048](./docs/adr/0048-google-apps-and-gmail-app-password.md),
[0052](./docs/adr/0052-one-app-one-card.md))

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

**Reach it from your chat apps.** Under **Apps → Talk to me here**, connect Telegram,
Discord or Slack in a few guided steps — no public address or tunnel — and approve
what the assistant asks right there. Nobody gets in unless you let them. ([ADR 0018](./docs/adr/0018-channels.md))
Or link your own WhatsApp or Signal by scanning a code, and talk to your assistant
in the chat with yourself; your friends' chats are never read.
([ADR 0043](./docs/adr/0043-whatsapp-and-signal.md))
On a Mac, text yourself on iMessage; anywhere, write to `you+conch@` from any mail
app and get the answer in the thread. Conch reads only that chat and that address,
and believes an email's sender only when your mail service vouches for it.
([ADR 0044](./docs/adr/0044-imessage-and-email.md))
Matrix (encrypted chats too), Microsoft Teams and WeChat connect the same guided
way. Teams and WeChat's Official Accounts need a public address: Conch opens one
with one press, and it lets in only their signed messages.
([ADR 0045](./docs/adr/0045-teams-matrix-wechat.md))

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

**The app.** Conch for macOS, Windows and Linux, as a download: its own window, the
pearl in the menu bar, Always on, and each release one press away (installed by
itself where the computer lets it). It carries Node and Conch inside, keeps your things in `~/.conch` like any
other Conch, and shows a Conch that's already running instead of starting a second.
Links and sign-ins open in your own browser. ([ADR 0054](./docs/adr/0054-the-desktop-app.md))

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
what would come over: your memories, persona and what it knows about you, the model
you used (matched to what's connected here, or a sentence why not), skills (read
through first, and off until you turn them on), scheduled jobs (as draft routines),
OpenClaw's other agents (each as a skill you pick in a chat) and, only if you tick
them, your chat bots and keys. A Slack bot with one of its two keys comes with a
button to the Slack page that has the other. It backs up first,
leaves the other app's folder alone, and Undo takes it all back.
`pnpm conch import --from openclaw --dry-run` shows the same list in a terminal.
([ADR 0035](./docs/adr/0035-come-home.md), [ADR 0042](./docs/adr/0042-come-home-the-rest.md))

**Show me.** Ask for a chart, a page, a document, a diagram or a table, and it opens
beside the chat: every version kept, with what changed, ready to copy, download or open
full screen. Pages run sealed off, so one made after reading something hostile still
can't reach your things or the internet. Pin one as an app in the sidebar, and refresh
it with fresh data whenever you like. ([ADR 0034](./docs/adr/0034-show-me.md))
Press **Edit** to change it yourself, with the preview following as you type; your
version is marked as yours, and your assistant builds on it. A page can show live
data from sites you allow, read by Conch for it, never with your sign-ins.
([ADR 0046](./docs/adr/0046-edit-by-hand-and-live-data.md))

**Hand it off.** Press ⌘⇧↩ to send something to the background and keep chatting:
a live card shows what it's doing, **Tasks** shows everything that's working, and
its result comes back to your chat, with a notification when it's done. The
assistant can split a job and run the parts side by side on a faster model, each
in its own copy of the folder if it's code. Helpers ask as you would, stay as
careful as their chat, and stop when you stop. ([ADR 0033](./docs/adr/0033-hand-it-off.md))

**Skills you can trust.** Every skill says what it can do ("run commands (only
`git`)"). Once it's in a chat, anything else asks first, in every later turn too:
a quiet line says "Held to Quick setup's list", and only you can stop it. Signed
skills say who made them: trust a publisher once and their skills say **Verified**,
and their updates carry on. A skill changed after it was signed turns off. Sign your
own with `pnpm conch skills sign <folder>`; your key is locked with this computer's
own key. Commands are sealed in Codex too, and **Settings → Security → Safety** says
plainly which providers are sealed. ([ADR 0031](./docs/adr/0031-skill-trust.md),
[0047](./docs/adr/0047-skill-scope.md))

**It looks after itself.** **Settings → Health** has one **Repair everything**
button, a quiet list of what Conch fixed on its own, daily backups you can restore
(with a preview and Undo), and one-click updates for Conch and the programs it uses.
Conch follows signed releases (stable by default, beta or alpha if you like),
says what each one brings in a few plain words, gets it ready while you keep
working, and goes back at once if it doesn't start. Conch restarts itself after a crash.
Maintainers release with `pnpm release` ([docs/RELEASING.md](./docs/RELEASING.md)).
([ADR 0016](./docs/adr/0016-getting-what-a-feature-needs.md),
[0019](./docs/adr/0019-updates.md), [0020](./docs/adr/0020-backups.md),
[0051](./docs/adr/0051-releases.md))

**One box for everything.** <kbd>⌘</kbd> + <kbd>K</kbd> finds chats and messages,
models, skills, apps, routines, pages and settings by name.

## Development

```bash
pnpm dev            # web on :5173 (hot reload) + gateway on :4317
pnpm dev:mock       # same, with a scripted engine and pretend apps — no model usage
pnpm storybook      # explore Nacre at http://localhost:6006
pnpm docs:dev       # the site at http://localhost:4400: the front page, and the documentation at /docs
pnpm check          # format + lint + typecheck + tests — must pass before every commit
pnpm e2e            # Playwright journeys against the gateway and the mock engine
pnpm desktop:dev    # the desktop app on the repository, with hot reload
pnpm desktop:start  # the desktop app as it ships, without packaging it
pnpm desktop:build  # this computer's installers in apps/desktop/out (CI builds every platform)
pnpm desktop:e2e    # drive the desktop app with Playwright
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
| `apps/docs`         | The site: front page, guides in Markdown, reference read from the code   |
| `apps/desktop`      | The Electron app for macOS, Windows and Linux                            |
| `packages/nacre`    | Design system + Storybook                                                |
| `packages/protocol` | Zod-validated wire protocol                                              |
| `e2e`               | Playwright journeys                                                      |

## Docs

**`pnpm docs:dev` opens the site**: the front page, and under `/docs` the
documentation: getting started, every provider and channel, each feature, and the
reference for the command line, configuration and API. Its lists and numbers are read
from the code, so they are never behind it
([apps/docs](./apps/docs/content/README.md)). The files it is made from:

- [AGENTS.md](./AGENTS.md) — how to work in this repo (humans and AI agents)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design and security model
- [docs/SECURITY.md](./docs/SECURITY.md) — signing in, phones, recovery, warnings
- [docs/BROWSER.md](./docs/BROWSER.md) — the browser: watching, taking over, what it asks
- [docs/TERMINAL.md](./docs/TERMINAL.md) — the terminal: shortcuts, the assistant, other devices
- [docs/design/NACRE.md](./docs/design/NACRE.md) — the design language
- [docs/adr](./docs/adr) — decision records (0001–0054)
