# 0081 — Mattermost: a bot on your own server, over its WebSocket

- Status: accepted
- Date: 2026-10-04
- Amends: [ADR 0018](./0018-channels.md) (one more app, the same shape)

## Context

Mattermost is the team chat people run on their own servers, often because
they don't want their messages on someone else's. OpenClaw and Hermes Agent
both reach it. What it offers (checked 2026-10-04, developers.mattermost.com):

- **Bot accounts** (System Console → Integrations → Bot Accounts), each with
  personal access tokens made on the bot's page.
- **A WebSocket API** at `/api/v4/websocket`, authenticated by sending the
  token in an `authentication_challenge` action once it opens. It answers
  `hello`, and sends a `posted` event for every post the bot can see, with the
  channel's type (`D` is a direct message) and the user ids it `mentions`.
- **Interactive buttons** only work when the server can reach an integration
  URL, which Conch, behind a router, usually can't offer.

## Decision

**Mattermost is a channel like Discord** (`channels/mattermost.ts`): a bot
account you make, its token pasted with the server's address, checked at
once (`GET /api/v4/users/me`). Conch opens the WebSocket from this computer,
so nothing needs a public address, and the server only has to be reachable
from here.

- **The token never goes in an address**: only in the `Authorization` header
  and the first WebSocket message. Over plain `http://` it goes only to this
  computer or a private network; anywhere else the setup asks for `https://`.
- **Answers keep their Markdown**, cut at 8000 characters a post.
- **Approvals are numbered** (`TextChoices`), as on WhatsApp: a reply of `1`
  allows. A decided question is edited to say so.
- **Working on it** shows as 👀 on your message, and typing… in the channel.
- **Files** come only from this server's `/api/v4/files`, with the bot's
  token, at most 25 MB.
- **Healing**: the socket reconnects with backoff after a drop; pings every
  30 seconds replace a socket that stopped answering; a refused token stops
  this channel only and asks for a new one (just the token: the server stays).
- **Groups** (ADR 0075): a channel the bot is in is a group, answered only
  once you turn it on and only when it's @mentioned; everyone but you gets
  words only.

The pieces: `ChannelKind` and `ChannelSecrets` gain `mattermost` (`server`,
`token`), `ReplaceChannelTokenBody` a token on its own, and a pretend
Mattermost (`channels/mock/mattermost.ts`) with its WebSocket for tests, e2e
and `pnpm dev:mock`.

## Security

- **Who can reach it**: people on your server who can message the bot. As on
  every channel, nobody gets in until you press **That's me** or **Let in**;
  anyone else gets one polite reply.
- **The key** lives in the sealed `channels.secrets.json`, listed in
  Passwords, never logged (`redact`), and sent only to the server it was made
  on.
- Its own posts, system messages and other bots' posts are never read.

## Consequences

- Making a bot account needs Bot Accounts turned on by whoever runs the
  server; the setup says where.
- Tested against a pretend Mattermost that speaks its WebSocket protocol
  (`mattermost.test.ts`), including a dropped socket and a revoked token.
