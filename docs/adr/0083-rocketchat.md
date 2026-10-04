# 0083 — Rocket.Chat: a bot on your own server, over its realtime API

- Status: accepted
- Date: 2026-10-04
- Amends: [ADR 0018](./0018-channels.md) (one more app, the same shape)

## Context

Rocket.Chat is the other team chat people run on their own servers, beside
Mattermost (ADR 0081). What it offers (checked 2026-10-04,
developer.rocket.chat):

- **A bot is a user with the `bot` role.** It authenticates with a personal
  access token, which comes with its user id (REST headers `X-User-Id` and
  `X-Auth-Token`).
- **The realtime API** is DDP on a WebSocket at `/websocket`: `connect`, then
  the `login` method with the token as a `resume` token, then a subscription
  to `stream-room-messages` with `__my_messages__`, which sends every message
  in a room the user is in, with who it `mentions`. The server pings; a client
  answers `pong`.
- **Interactive buttons** need the server to reach an integration URL, which
  Conch usually can't offer.

## Decision

**Rocket.Chat is a channel like Mattermost** (ADR 0081), in
`channels/rocketchat.ts`: the server's address, the bot's user id and token,
checked at once (`GET /api/v1/me`). Conch opens the realtime connection from
this computer; nothing needs a public address.

- **The token goes only in REST headers and in DDP's `login`**, never in an
  address; over plain `http://` only to this computer or a private network.
- **A direct message room (`t: 'd'`) is a private chat**; any other room is a
  group (ADR 0075), answered only once you turn it on, when it's mentioned.
- **Markdown answers**, cut at 4800 characters; **numbered approvals**
  (`TextChoices`), edited once decided; 👀 while it works; typing… through
  `stream-notify-room`; files only from the same server.
- **Healing**: pings are answered, a socket silent for 70 seconds is replaced,
  drops are retried with backoff, and a refused token (`login` fails, or REST
  answers 401) stops this channel only and asks for a new token. The user id
  stays the bot's own.
- `ChannelKind` and `ChannelSecrets` gain `rocketchat` (`server`, `userId`,
  `token`), `ChannelField` gains `userId`, and a pretend Rocket.Chat
  (`channels/mock/rocketchat.ts`) speaks DDP for tests, e2e and
  `pnpm dev:mock`.

## Security

As for Mattermost: nobody gets in until you press **That's me** or **Let in**,
the token lives in the sealed `channels.secrets.json`, listed in Passwords,
never logged, and goes only to the server it was made on. Its own messages,
system messages, edits and other bots are never read.

## Consequences

- Making the token needs signing in as the bot once (or an administrator
  making it for it); the setup says how.
- Tested against a pretend Rocket.Chat that speaks its realtime protocol,
  including a dropped socket and a removed token.
