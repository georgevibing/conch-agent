# 0018 — Channels: reaching your assistant from Telegram, Discord and Slack

- Status: accepted
- Date: 2026-09-30

## Context

Conch lives on your computer, so until now you could only talk to it from a
browser that can reach that computer. People want to ask from their phone,
in the chat apps they already use, and to approve things from there when
the assistant asks. Conch usually runs behind a home router with no public
address, and the person setting it up may never have used a developer
portal.

How related tools set this up (September 2026):

| Product                     | Setup                                                                                            | Who may talk                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| OpenClaw                    | `openclaw onboard` / `channels add` in a terminal; token pasted, checked when the gateway starts | 8-character pairing code the owner approves with `openclaw pairing approve` |
| Hermes Agent                | `hermes gateway setup`; env files; Telegram "Create with QR" through a Nous-hosted manager bot   | allowlists of numeric ids (find yours with @userinfobot) or pairing codes   |
| Claude Code Channels        | `/plugin install`, `/telegram:configure <token>`, restart with a flag, then a pairing code       | 6-character code approved in the CLI                                        |
| n8n, Zapier, Home Assistant | paste the token                                                                                  | n/a                                                                         |

What the platforms allow:

- **Telegram**:
  - Long polling (`getUpdates`) works from behind NAT.
  - `t.me/<bot>?start=<payload>` delivers a one-time code when the person presses Start.
  - The bot's commands, descriptions and profile photo can be set through the API.
  - `sendMessageDraft` (Bot API 9.5+) streams a reply in private chats, and since 10.3 shows a native Stop button.
  - Bot creation can be automated only through a centrally hosted "manager bot" (Bot API 9.6), which would give its operator standing control of every user's bot.
- **Discord**:
  - The Gateway is an outbound WebSocket.
  - Direct messages carry their text without the privileged Message Content intent.
  - A person can only DM a bot they share a server with (error 50278).
  - There is no API to create an app, so the token has to be copied from the Developer Portal.
- **Slack**:
  - Socket Mode is an outbound WebSocket, opened with an app-level token (`xapp-`, `connections:write`) that can only be made by hand.
  - An app can be created from a manifest through `api.slack.com/apps?new_app=1&manifest_json=…`.
  - The bot token (`xoxb-`) comes from installing the app.
  - Bots have no typing indicator.

## Decision

**A channel is a bot you own**, not a shared Conch bot. Conch runs no
servers of its own, so there's no relay to trust and nothing between your
phone and your computer but the chat app. Every channel connects **outward**:

- Telegram: long polling;
- Discord: the Gateway WebSocket;
- Slack: Socket Mode.

Nothing on your computer is exposed to the internet, and no tunnel is needed.

**What you send becomes a Conch conversation** with the default provider,
started with `ConversationManager.send({ origin: { kind: 'channel' } })`, so
every provider works and the chat appears in the sidebar, wearing the app's
logo. How a turn comes back:

- Assistant messages are sent as they finish, formatted for each app:
  - Telegram HTML, and plain text if Telegram refuses the markup;
  - Discord Markdown;
  - Slack `markdown` blocks, and mrkdwn where a workspace refuses them.
- Long answers are split between paragraphs; a code block that has to be cut is closed and reopened.
- Telegram streams the answer as a draft, at most one update a second, and its Stop button interrupts the turn.
- Discord shows typing…; Slack gets a 👀 on your message instead.
- Messages sent within 700 ms of each other (a photo album, a thought typed in pieces) go as one.
- Photos and files become attachments (ADR 0017).
- A message sent while a turn runs waits and goes next.
- `/new` starts a fresh conversation, `/stop` stops the turn and `/help` explains.
- Any other `/name` reaches the gateway as typed, so your skills work by name.

**Approvals come to the chat as buttons**: Allow, Always in this chat, Don't
allow (Telegram inline keyboards, Discord components, Slack actions). The
button data is a random key that points to the question, which also fits
Telegram's 64-byte limit. A press counts only from someone let in, in the
chat where the question was asked. When the question is answered anywhere,
the message changes to say what was decided. Routine results, and routines'
questions with their buttons, go to the owner of every channel that has
**Routine results** on.

**Who may talk.** Nobody, until you:

- **Telegram**: the connect page shows a `t.me/<bot>?start=<code>` link and
  its QR code. The code is 96 bits, lasts 10 minutes, works once, is kept
  only as a hash and is compared in constant time. Pressing Start lets its
  sender in as the owner. This is the only thing the bot can decide on its
  own, and only for a code the page just made.
- **Discord and Slack** have no such link. You message the bot, and the
  page asks **Is this you?** with your name, the message and **That's me**.
- **Everyone else** gets one polite reply (at most every 30 minutes) that
  names no one, and appears as a request you can **Let in**, **Block** or
  clear. Blocked people get nothing, ever. Requests are capped at 20.
- **Private chats only**: groups and servers are ignored, because anyone in
  them could speak for you. (Since amended by [ADR 0075](./0075-group-chats.md):
  a group you turn on is answered when it mentions the bot, you as in
  private, everyone else in words only.) So that it never looks broken there, a message
  that reaches the bot in a group gets one reply pointing to a private chat,
  at most every 30 minutes.

**Setup is a guided path beside a picture.** `/channels/new/<app>` is a
numbered `GuideSteps` path. Next to it, Nacre's `Handset` shows the chat app
as you'll see it (BotFather's reply with the key lit up, the Start button to
press), and `PortalSketch` draws the web page with the button to press.

What Conch works out so you don't have to:

- The two answers BotFather asks for (a name, and a username that is very likely free).
- The key, found in whatever was pasted, including BotFather's whole message, pasted anywhere on the page.
- The Slack manifest (Messages tab on, Socket Mode on, the right scopes), with a copy-and-paste fallback.
- Slack's two keys, sorted whichever box they were pasted in.
- The Discord invite link (no permissions at all).
- The bot's commands and description.

Every key is checked with the app the moment it lands, so there is no Save
button. The Discord step that adds the bot to a server ticks itself off
when the bot arrives there (`GUILD_CREATE`).

**Healing** (AGENTS.md agreement 11):

- **Telegram**:
  - A webhook left by another tool is deleted.
  - Another program polling the same bot is waited out, retried every minute and named ("another Conch, or an app like OpenClaw").
- **Discord**:
  - Sessions resume after a drop.
  - A zombie connection is noticed by a missed heartbeat reply and replaced.
  - Identifies are rationed well below the daily limit that would get the token reset.
  - A leftover Interactions Endpoint URL, which would swallow button presses, is cleared.
- **Slack**: `refresh_requested` reconnects at once; `link_disabled` names the setting to switch back on.
- **Every channel**:
  - A key that stops working stops that channel only, and asks for a new key for the same bot (`needs-token`).
  - Everything else retries with backoff (1 s up to 1 min, with jitter).
  - An outage of more than a minute leaves a "Fixed on its own" note.
  - A chat deleted in Conch starts a new one on the next message.
  - A failure in one channel never touches another.
  - Channels reconnect on start.

**Other apps later.** The catalog shows WhatsApp, Signal, iMessage, Teams
and Matrix as coming (WhatsApp and Signal came as linked devices of your own
account: ADR 0043; iMessage and email through accounts already yours: ADR 0044). Most channels that need a public webhook (LINE, Teams,
Messenger) wait for a way that doesn't. (Since amended by
[ADR 0045](./0045-teams-matrix-wechat.md): Teams, Matrix and WeChat are here, and
the apps that only deliver to a web address come in through one public door.) A hosted Telegram "manager bot" for
one-tap bot creation was rejected for now: it would put a Conch-run service
between you and your bot, with standing power over its token.

## Security

- **Who can reach it**:
  - The chat app's servers, with messages from anyone. Only private chats from people let in reach a conversation; the rest become requests.
  - A person holding your phone or account can use your assistant as you do. The checkup warns when chats from channels start in Full trust (`channels-full-trust`, fix: Ask first) and lists anyone else let in (`channel-people`).
- **The agent can't let anyone in.** There's no tool for channels. Letting
  someone in, connecting a bot, making a hello link, turning a channel back
  on and replacing its key are HTTP routes. From another device they need a
  password or key from the last 10 minutes. Switching off, blocking and
  removing never do.
- **Keys**:
  - They live in `~/.conch/channels.secrets.json` (0600).
  - They're never returned, logged, or put in an error message (`redact`; Telegram puts the key in its URLs).
  - A string that isn't shaped like a key is never sent anywhere.
- **Downloads**: files only come from each app's own file hosts
  (`api.telegram.org`, `cdn.discordapp.com`, `media.discordapp.net`, and
  `*.slack.com` with the bot token). A Slack sign-in page served instead of
  a file is refused.
- **Messages are yours**: what someone let in writes is treated like typing
  in Conch. Messages from strangers never reach a model.
- Tests: `channels/routes.test.ts` (fresh sign-in, keys never returned,
  path-like ids) and `service.test.ts` (strangers, blocked people, reused
  and wrong codes, presses from someone not let in).

## Consequences

- Each app needs one bot you make yourself: about two minutes for Telegram,
  four for Discord and Slack.
- On Discord you need a server to share with the bot (making one takes ten
  seconds); the page says how.
- Conch has to be running for the bot to answer. Telegram keeps messages
  for 24 hours, so they're answered when Conch comes back; Discord and
  Slack don't redeliver DMs sent while it was off.
- Each app has a pretend version for tests, e2e and `pnpm dev:mock`
  (`channels/mock/`). They start only with `CONCH_ENGINE=mock`.
  `CONCH_MOCK_TELEGRAM_PORT`, `CONCH_MOCK_DISCORD_PORT` and
  `CONCH_MOCK_SLACK_PORT` ask for a port; a taken one falls back to any free
  port. `GET /api/channels/mock`, which exists in mock mode only, says where
  they are.
