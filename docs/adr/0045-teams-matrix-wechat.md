# 0045 — Microsoft Teams, Matrix and WeChat, and the public door

- Status: accepted
- Date: 2026-10-02
- Amends: [ADR 0018](./0018-channels.md) (§ Other apps later)

## Context

ADR 0018 made every channel connect outward, and said that "an app that only
offers webhooks waits". Three apps people asked for each break that rule in a
different way:

- **Matrix** has a client-server API you can long-poll (`/sync`), so it fits.
  But direct messages in Element are end-to-end encrypted by default, and a
  bot that can't read them looks broken.
- **Microsoft Teams** only delivers to a bot's _messaging endpoint_, a public
  HTTPS address. Every delivery carries a Bot Framework JWT. Microsoft
  stopped letting people create multi-tenant bots after July 2025, so a new
  bot may need its tenant to get a token.
- **WeChat** has no official bot API for a personal account. The tools that
  automate one (web or iPad protocols, hooks) break its terms, and
  accounts that use them get banned. Tencent's own ways are:
  - a **WeCom (企业微信) AI bot**. Since March 2026 (doc 101463) it has a
    _long connection_ mode: `wss://openws.work.weixin.qq.com`, with a Bot ID
    and a Secret. No public address, no IP whitelist, no domain filing.
  - a **WeCom self-built app**. Since June 2022 a new one must list trusted
    IPs (error 60020) before it may call the API, and its callback domain
    rules point at an ICP-filed domain. Hard for a person at home.
  - **WeCom's WeChat plugin**. It shows app messages in personal WeChat
    as text cut to 20 bytes, and only to members of the team. Not usable.
  - an **Official Account** (公众号). Its server URL must be on port 80 or 443. A reply must come within 5 seconds (3 attempts). Customer-service
    messages (客服消息: within 48 hours, at most 5) are only for verified
    accounts with a company behind them. An individual's account can't send
    them.
  - the **test account** (测试号). Free, made by scanning a code, and it has
    every advanced interface. Unconfirmed: about 100 followers, and
    plaintext mode only.

Sources: the primary sources above, checked 2026-10-02:

- learn.microsoft.com, Bot Connector authentication;
- botbuilder-js `channelValidation.ts` and `jwtTokenExtractor.ts`;
- developer.work.weixin.qq.com paths 90664, 90930, 90236, 101463, 94677;
- developers.weixin.qq.com `/doc/service/` (server URL, passive replies,
  `custom/send`, the IP whitelist);
- tailscale.com kb 1223 and 1311 (Funnel ports, `--set-path`), and
  `ipn/ipnlocal/serve.go` (the mount path is stripped);
- WeCom's own `aibot-node-sdk` 1.0.7 (frames, file decryption).

## Decision

### The public door

One way in from the internet, for the apps that only deliver to a web
address (`channels/door.ts`). It is **not the gateway**:

- **Where it listens.** A second Fastify listener on `127.0.0.1:4319`
  (`CONCH_DOOR_PORT`). A taken port moves it along up to nine ports, and
  `door.json` remembers where.
- **What it serves.** Only `/hooks/<id>`, where `<id>` is 144 random bits
  made when the channel was connected. It also answers `/ping/<nonce>`.
  Everything else is a 404. No cookies, no sign-in, no app, no API, no
  `trustProxy`.
- **What it takes.** At most 1 MiB per body, 20-second timeouts, and 240
  deliveries a minute per address.
- **What gets in.** Each delivery must carry the app's own signature, and
  the channel checks it before reading anything.

The internet reaches the door one of two ways, both a person's choice in the
UI (the trusted routes, ADR 0018; from another device, a fresh sign-in):

- **Tailscale Funnel** (one press):
  `tailscale funnel --bg --https=<port> --set-path=/conch http://127.0.0.1:<door>`.
  - **The port.** Funnel makes a whole port public, and the phone's private
    address (ADR 0027) is on 443. So the door takes 443 when that's free,
    else 8443, else 10000. It refuses if all three carry something else.
  - **Where it goes.** The mount path is stripped on the way through, and
    the door accepts both forms.
- **An address of your own.** A reverse proxy, frp or a tunnel that forwards
  to the door's port. It must be HTTPS, with no credentials, query or
  fragment.

Either way the address is checked from the outside: Conch fetches
`<url>/ping/<nonce>`, and the answer must be this door's HMAC of the nonce.
So an address that leads somewhere else is never called ready.

- **Healing.** Checked every 10 minutes and in **Repair everything**
  (`doorCheck`). A Funnel that Tailscale forgot is put back, and a door
  that moved port is pointed at again. That only happens on the computer
  it was turned on for (`door.json` keeps the tailnet name). Restored from
  a backup onto another computer, it opens nothing by itself.
- **The checkup.** The security checkup names an open door, and the apps
  it's for (`channel-door`).
- **Tailscale missing?** That's the existing `tailscale` need (ADR 0016).
  When it lands, the door carries on turning itself on.

### Matrix

`channels/matrix.ts` is a lean client of its own: login, `/sync`, rooms,
typing, receipts, authenticated media and `m.direct`. It isn't
`matrix-js-sdk`, whose browser store and sync loop Conch would have to work
around.

- **The account.** The assistant gets an account of its own. The person
  types its password once. Conch signs in as a new session ("Conch") and
  keeps only that session's access token. A pasted token is refused if its
  session already has encryption keys (Element's), because sharing it would
  break that session's encryption.
- **Encryption.** It uses Matrix's own Rust crypto, `matrix-sdk-crypto-wasm`
  (the code Element uses), with no native code.
  - **Where its store lives.** Its IndexedDB store runs in
    `fake-indexeddb`, in memory. After every sync that changed something,
    Conch writes a snapshot of that session's databases, together with the
    sync position, to `channels/matrix-<id>.json`.
  - **Why together.** A crash can only replay a sync Conch already handled.
    It can never lose a key it has used.
  - **What protects it.** Values in the store are encrypted by the crypto
    with a store key, which lives in the sealed `channels.secrets.json`.
  - **Who it believes.** Decryption uses `CrossSignedOrLegacy`: messages
    from a session the sender's account never signed are refused, and the
    bot says why. That defeats a homeserver slipping a device into the
    owner's account and giving orders.
  - **No crypto?** If it can't load, the bot says so in encrypted rooms and
    never goes quiet.
- **In rooms.**
  - It joins DM invites only (at most 20 an hour), and declines groups,
    giving the reason.
  - Approvals are reactions the bot adds itself (✅ ♾️ ❌), or a typed number.
  - Edits change what was decided.
  - Encrypted attachments are checked against their SHA-256 hash, then
    decrypted (AES-CTR).
  - Messages are sent with `formatted_body` HTML.

### Microsoft Teams

`channels/teams.ts` and `teams-auth.ts`.

- **Every delivery's JWT is checked**, as Microsoft documents and botbuilder
  does:
  - the key comes from Bot Framework's OpenID metadata over HTTPS, cached
    for a day; an unknown `kid` refreshes it at most every 5 minutes;
  - the key must be endorsed for `msteams`;
  - RS256/384/512 only (`jose`), so never `none` or HMAC;
  - the issuer is `https://api.botframework.com`, the audience is the
    bot's App ID, and 5 minutes of clock skew is allowed;
  - the `serviceurl` claim must equal the activity's `serviceUrl`.
- **The bot's own token** goes only to Microsoft's connector hosts
  (`smba.trafficmanager.net`, `*.botframework.com`, `*.teams.microsoft.com`
  and their government clouds). It comes from client credentials against
  `botframework.com`, or the tenant for a single-tenant bot. Microsoft's own
  error codes become the box to fix: an expired secret, a secret ID pasted
  instead of its value, a missing tenant.
- **Deliveries are acknowledged at once.** Answers go through the connector
  as HTML, with approvals as an Adaptive Card. A message is edited once it's
  decided.
- **It remembers where each chat lives** (`channels/teams-<id>.json`, no
  keys), so routine results reach you after a restart.
- **The Teams app package** (`GET /api/channels/:id/teams-app`) is made
  with `node:zlib` alone: a manifest 1.17 personal bot with `supportsFiles`,
  and 192×192 and 32×32 icons drawn in code.

### WeChat

`channels/wechat.ts` and `wechat-crypto.ts`.

- **The default is the WeCom AI bot**, over its long connection:
  - subscribe, then heartbeats every 30 s; two missed answers replace the
    socket;
  - `aibot_send_msg` in Markdown, and approvals as a `button_interaction`
    template card;
  - files decrypted with their own key.
  - There is one connection per bot. Another program connecting is named
    (conflict, retried every minute). Conch's own key check never opens a
    second one while a connection runs.
  - You chat in the WeCom app, not in personal WeChat, and the setup says so.
- **An Official Account (or its test account)** comes through the door:
  - **Signatures.** `signature`, and in safe mode `msg_signature`, are
    checked in constant time. A timestamp more than 10 minutes off is
    refused, and a repeated `MsgId` is one message.
  - **Encryption.** The message is decrypted (AES-256-CBC, PKCS#7 to 32
    bytes) and must name this AppID.
  - **Reading it.** The XML is read element by element by a parser that
    knows only WeChat's flat form. It allows no DOCTYPE and no entities
    that expand, and treats CDATA as whole. So what someone typed can never
    become a field of its own.
  - **Answering.** An answer ready within 4.5 s goes back in the reply
    (encrypted in safe mode). Later ones go as customer-service messages.
  - **An account that may not send them** (48001) keeps WeChat waiting
    through its retries. Then it says it's still working, and the answer
    comes back with the next message ("?" fetches it).
  - **What Conch makes.** The Token and EncodingAESKey, shown on request
    (`GET /api/channels/:id/hook`, a trusted route).
- **Verified against Tencent's own sample vectors** (WXBizMsgCrypt: token
  `QDG6eK`, the URL check and an encrypted message), with tampering,
  another account's message and XML injection tests beside them.
- **People have no names.** An Official Account only knows an `openid`.
  Requests show its end, and the owner is called by the name they gave
  Conch.

### Shared changes, kept additive

- **Kinds and keys.** `ChannelKind`, `ChannelSecrets` and
  `CheckChannelBody` gain three members each.
- **The adapter interface** gains `settle` (sign in once), `release` (end
  Conch's session there), `hook`/`hookSecrets`, and the `heard`/`changed`
  events.
- **The rest.** `ChannelHook` and `ChannelDoor` are in the protocol, with a
  `channel.door` event. `personId`/`appId` keep app ids that aren't
  Conch `Id`s (`@ada:matrix.org`) reversibly.

### Dependencies

- `@matrix-org/matrix-sdk-crypto-wasm` 18.9: E2EE, Apache-2.0.
- `fake-indexeddb` 6.2: its store in Node, Apache-2.0.
- `jose` 6.2: JWT verification, MIT.

Nothing else is installed; Tailscale was already a need.

## Security

- **Who can reach it**: the internet, at the door only, and only at
  addresses that exist, with the app's signature. The gateway never sees
  those requests. Loopback alone isn't trust (agreement 2): the door is a
  different listener, so a request through Funnel can't reach a route that
  trusts loopback.
- **Forged deliveries are tested** (`teams.test.ts`): a wrong signing key,
  issuer, audience, `serviceUrl`, an unendorsed key, an expired token,
  `alg: none` and HS256 with the public key are each answered 401, and none
  reaches a conversation. WeChat's tests cover the same ground: a bad
  signature, a tampered ciphertext, a stale timestamp, a replayed message.
- **Keys.**
  - **Where they live.** Teams' secret, Matrix's access token and store key,
    and WeChat's secret, Token and EncodingAESKey all sit in the sealed
    `channels.secrets.json`. They're in Passwords and never logged.
  - **The new files.** The Matrix crypto snapshot is a `secret` backup file,
    and `channels/` is a protected path, as is `door.json`.
  - **Passwords.** Matrix passwords are never stored.
- **The agent** can't open the door, read the hook secrets or connect a
  channel. Those are routes a person uses; from elsewhere they need a fresh
  sign-in, and closing the door never does.
- **Untrusted people** are handled as ADR 0018 and ADR 0028 say: requests,
  taint for anyone but the owner, and the owner's approvals routed to them.

## Consequences

- **Teams takes about eight minutes**, and needs a work or school account
  that may upload custom apps. Teams free and personal accounts aren't
  known to allow it, and the page says what to ask an admin.
- **WeChat-in-WeChat has real limits**, said in plain words:
  - the test account's follower cap;
  - an individual's account answers within 5 s or with your next message;
  - the standard port: with the phone's address on 443, Funnel uses 8443,
    and WeChat then needs an address of your own.
- **Tailscale Funnel may be unreachable from mainland China**, so Chinese
  users may prefer the WeCom bot (outbound) or an address of their own.
- **The Matrix bot's session shows as unverified** in Element until you
  verify it. That changes nothing about what it reads, since its rule is
  about your sessions, not its own.
- **What was verified for real.** The crypto and the signatures:
  - Matrix: two copies of the real Rust crypto, Conch and a pretend
    Element, through a pretend homeserver, including cross-signing and a
    restart restored from the snapshot;
  - WeChat: Tencent's published vectors;
  - Teams: real RS256 JWTs signed by a pretend Bot Framework.
- **What wasn't.** No real Teams tenant, homeserver, WeCom team or Official
  Account was reached from this machine. The Developer Portal's and WeCom
  admin's button names come from their documentation.
- Pretend Teams, Matrix and WeChat start with `CONCH_ENGINE=mock`
  (`CONCH_MOCK_TEAMS_PORT`, `CONCH_MOCK_MATRIX_PORT`,
  `CONCH_MOCK_WECHAT_PORT`), with the door on a free port and a pretend
  Funnel.
