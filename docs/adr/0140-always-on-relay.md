# 0140 — The always-on relay

- Status: accepted
- Date: 2026-10-19
- Builds on: [ADR 0018](./0018-channels.md) (channels), [ADR 0026](./0026-always-on.md)
  (always on), [ADR 0045](./0045-teams-matrix-wechat.md) (the public door),
  [ADR 0056](./0056-when-routines-and-the-pulse.md) (the pulse and its sources),
  [ADR 0057](./0057-routines-cant-run-up-a-bill.md) (spending),
  [ADR 0064](./0064-your-own-address.md) / [0067](./0067-your-address-through-a-tunnel.md)
  (your own address), [ADR 0107](./0107-check-ins-standing-orders-and-the-morning-note.md)
  (check-ins)

## Context

Conch runs on the person's computer. Everything that is pushed to it stops when the
computer is off or asleep: Twilio texts, Teams, LINE, Google Chat and WeChat
deliveries, and routine webhooks all arrive at the public door
(`channels/door.ts`), and a sender that gets no answer doesn't try again (ADR 0018;
Twilio and Bot Framework retry for seconds, not hours). ADR 0006, 0056 and 0107 all
say "while Conch is running". Pull-based sources are different: Gmail, the calendar,
Telegram's `getUpdates` and outbound sockets can be asked what was missed, as long
as the cursor and the bounds are right.

## Decision

### 1. A relay, separate from Conch, that can't read what it keeps

`apps/relay` is a small program the person deploys somewhere that's always on. It is
an app, not a package, because it is deployed on its own and has its own entry
points; the gateway imports only its envelope (`@conch/relay/envelope`) so both ends
share one implementation. It has **no runtime dependencies and no build**: the core
is one fetch handler (`core.ts`: `Request` in, `Response` out) using only WebCrypto,
and Node 22.18+ runs the `.ts` files as they are (type stripping;
`erasableSyntaxOnly` keeps them strippable). What runs is what was reviewed.

- **Primary target: Node** (`node.ts`, a file per delivery, written whole and renamed
  into place). It runs on a Raspberry Pi or a small server (`install.sh`, a systemd
  user unit, no root), or anywhere with Docker (`Dockerfile`: Fly.io, Render, a NAS).
  It is the target the repository can test end to end, and the one that needs no
  account with anyone.
- **Second: Cloudflare Workers' free plan** (`worker.ts`, `wrangler.jsonc`): every
  request goes to one SQLite-backed Durable Object, so the queue, the waiting long poll
  and the sender waiting for an answer share one place. Nothing to keep running; the
  same core and limits.

Validation inside the relay is by hand (it is tiny and must stay dependency-free); the
gateway validates everything it hears from the relay with Zod from `@conch/protocol`
(`relay.ts`).

### 2. The envelope

Each delivery is sealed the moment it arrives with **HPKE (RFC 9180), base mode,
single shot: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM**. Neither
`node:crypto` nor WebCrypto offers HPKE, so `envelope.ts` composes it from WebCrypto's
own X25519 (RFC 7748), HMAC (HKDF, RFC 5869) and AES-GCM exactly as the RFC writes
it, and its test holds it to the RFC's published vector A.1.1. No primitive is new;
a dependency (`@hpke/core`) was considered and not taken, since the relay must stay
dependency-free and the construction is short and vector-tested.

- A fresh ephemeral key per delivery, discarded once it's sealed: the relay can't
  open what it stored even a second later.
- `info` binds the ciphertext to this use; the `aad` is the delivery's id and the
  time it arrived, which the relay keeps beside it in the clear, so neither can be
  swapped without the gateway noticing.
- The plaintext is the request as the sender made it: method, query, headers (minus
  hop-by-hop headers, cookies and the forwarding headers that name the sender's IP)
  and the body, as text.

### 3. Pairing: nothing secret ever travels

**Set up a relay** (Settings → Health → Always on, and under the public door in each
channel's setup) makes an X25519 key pair and a 256-bit token on the gateway, sealed
in `relay.secrets.json` (`lib/sealed.ts`, `secret` in backups, protected from the
agent's tools). The relay is deployed with a **setup code**: the public key and the
token's SHA-256. Neither is a secret, so the code can sit in a command line, a
dashboard field or an environment variable, and nothing is typed but the relay's
address. Conch shows the command for each place (pinned to its own release tag):

- `npx wrangler@4 deploy --var CONCH_RELAY_SETUP:<code>`
- `curl -fsSL …/v<version>/apps/relay/install.sh | sh -s -- <code> v<version>`
- `docker run … -e CONCH_RELAY_SETUP=<code> "$(docker build -q …#v<version>:apps/relay)"`

Pasting the address (HTTPS only) checks it: the relay must answer `/relay/v1/status`
with the token and name **this Conch's key** (`keyId`). Only then does the door use it
(`via: 'relay'`), so every public address Conch hands out is the relay's
(`door.hookUrl`), and channels repoint their apps by themselves (Twilio's `SmsUrl`).
Setting up or connecting a relay changes where the internet reaches Conch, so from
another device it needs a recent verification, as the door does; forgetting it takes
reach away and needs none. `relay.json` records the computer it was paired on: a
backup restored elsewhere pulls nothing until a person sets it up there.

### 4. The relay's protocol

- `GET|POST /hooks/<id>`: a delivery. The gateway registers its addresses **by hash**
  (`PUT /relay/v1/hooks`), and anything else is a 404 before a byte is stored.
- `GET /relay/v1/next?wait=25`: a long poll. Items handed out are leased for a minute;
  one not acknowledged is handed out again.
- `POST /relay/v1/ack`: done with these ids (idempotent), with the gateway's own
  answer for a sender still waiting.
- `GET /relay/v1/status`: protocol, `keyId`, depth, bytes, the oldest.

The token travels only in `Authorization: Bearer` (never a URL) and is compared as a
SHA-256 in constant time.

**Live.** While the gateway's poll waits, a delivery is handed over at once and the
sender waits up to nine seconds for the gateway's real answer (TwiML, a WeChat echo,
202). Otherwise it gets a plain 200 (empty TwiML for Twilio) and the delivery waits.

### 5. Draining: the same handlers, no new trust path

`relay/service.ts` long-polls while the door's way in is the relay, and on start
drains what was kept. For each delivery it:

1. opens it with the private key; the id and time it opened to must equal what the
   relay said (the AAD already binds them);
2. refuses it if the relay claims it arrived more than a week (and an hour) ago, or
   more than five minutes in the future;
3. refuses it if the ledger has its id or its **digest** (address, method, query,
   body, and the ids a sender signs: Standard Webhooks' `webhook-id` and timestamp);
4. hands it to `door.deliver(hookId, request)`, the **same handler** a live delivery
   reaches through the door's listener, which checks the sender's own signature as it
   came (Twilio's HMAC over the relay address and the form, Standard Webhooks or
   GitHub HMACs, LINE's HMAC, WeChat's SHA-1, Teams' and Google Chat's JWTs);
5. acknowledges it **after** the handler answers. Nothing serves that address yet
   (channels mount as they connect): kept, for ten minutes after start; then that
   address is gone and it's let go. A 5xx: kept, up to five tries.

**Freshness after a wait.** A signature is checked as it came, but the checks that
refuse stale deliveries (Standard Webhooks' five minutes, WeChat's ten, LINE's hour,
JWT expiry) would refuse anything kept for longer. `HookRequest.receivedAt` carries
when it reached the relay (only for deliveries kept longer than a minute), and those
checks measure from it (`arrivedAt`, and jose's `currentDate`). It is the relay's
word, which is why step 2 bounds it and step 3 remembers digests for longer than the
bound: anything a relay could replay with a made-up time was, by construction,
already delivered and remembered.

Ack-after-processing and the ledger (`relay-seen.json`, derived, protected) make the
drain **idempotent by delivery id**, and by digest across new ids.

### 6. Bounds

At most 2,000 deliveries, 32 MB, 500 per address, a week each, 1 MB each; 240 per
address and 1,200 overall per minute (429 with `Retry-After`). A full relay answers
503 with `Retry-After` rather than evicting older deliveries. The gateway's ledger
keeps at most 20,000 entries.

### 7. Pull-based sources catch up from a cursor

- **Mail** (`triggers/mail.ts`) read at most 20 matching messages a look and moved its
  cursor to now: after a morning off, all but the newest 20 were lost without a word.
  Now a look asks for up to 100 ids, reads the newest 20 and adds one line for the
  rest (how many, and the Gmail search that shows them), reaching back a week at most.
- **The pulse** kept the newest 50 waiting happenings and dropped the rest silently.
  Now the oldest are **folded** into one line that counts them and names the first 20
  (`fold`). A backlog still starts one run, at most four an hour, under ADR 0057's
  spending guards: a week of webhooks never fires 200 routines.
- **Calendar** needed nothing: an event whose lead passed while Conch was off still
  starts before the meeting; one that's over is not news.
- **Check-ins** (ADR 0107) already look back a day at most, judge at most 12 things a
  look and wait under the spending guard; they use the same mail source and gain the
  folded line.
- **Scheduled routines** already catch up once, never a backlog (ADR 0006).

## Threat model

**Who reaches it.** The relay is on the internet by design. Anyone can send to it;
only the gateway's token reads from it.

- **The relay is compromised (its host, its storage, its operator).** At rest it holds
  ciphertext, the token's hash, the public key and hashed addresses. It learns
  metadata: when deliveries arrive, their sizes, how many per (hashed) address, the
  gateway's polling, and the gateway's answers to live senders (which go back to the
  sender in the clear anyway: "Accepted.", empty TwiML). A relay whose **code** is
  taken over sees what arrives from then on, as any TLS terminator (Funnel, a reverse
  proxy) does today; it still can't open what it already stored. It **can't forge** a
  delivery for a signed sender, because the signature is checked on the gateway with
  a secret the relay never had. It **can** drop or delay deliveries (availability is
  not protected), and it can forge deliveries to a routine address **without a
  secret**, whose only key is the address: the guide says to give such routines a
  secret.
- **Replay.** Within a lease, the gateway's ledger takes an id once. Under a new id
  or time, the digest refuses it. A made-up arrival time is bounded to a week, and
  the ledger remembers longer than that, so a replay with a fresh time is of something
  already remembered. Senders whose signature covers no id (GitHub without
  `x-github-delivery`, Teams, whose JWT doesn't bind the body) are no more replayable
  than through the door today: Twilio's form carries its `MessageSid`, Teams' and
  Google Chat's bodies their own event ids, and channels keep their own seen-sets.
- **Flooding.** Unregistered addresses are refused before storage; per-address and
  overall rate limits; a full queue refuses new deliveries instead of evicting old
  ones, and one address can fill at most a quarter of it. The gateway's drain is
  sequential and bounded per poll; a backlog is folded into one run.
- **The gateway's side.** The token is 256 bits, sent only in a header, compared by
  hash. The relay must be HTTPS. Its answers are parsed with Zod; a delivery that
  doesn't open, or doesn't match its id and time, is let go.
- **The agent.** `relay.json`, `relay.secrets.json` and `relay-seen.json` are
  protected paths: the agent can't point the door elsewhere, read the key or reset the
  ledger to replay. Its routes need a person (and recent verification from another
  device). A drained delivery taints exactly as a live one does (the same handler).
- **Restore elsewhere.** The key is only in a passphrase-locked backup; the pairing
  records its computer, and another computer pulls nothing until set up there.

Sources followed: RFC 9180 (HPKE) and its test vectors; RFC 7748 (X25519); RFC 5869
(HKDF); the Standard Webhooks specification (signing, timestamps, replay); Twilio's
webhook security guide (signature over the full URL); OWASP's Denial of Service and
REST Security cheat sheets (limits before expensive work, no secrets in URLs); OWASP
ASVS 5.0 V11 (cryptography: approved algorithms, no custom primitives).

## Whole Conch

A Repair everything check (`relay/doctor.ts`: reachable, this computer's key, queue
depth, set up on another computer; Repair asks again, re-registers the addresses and
brings in what waits); backup rules (`relay.json` kept, `relay.secrets.json` secret,
`relay-seen.json` derived); sealed file and protected paths; the key in Passwords
(shown, never copied); ⌘K "Always-on relay"; the guide `care/relay.md`.

## Consequences

- Every public address changes when the relay is turned on, and channels repoint
  themselves; turning it off goes back to no public address.
- Conch apps that receive webhooks check their own freshness inside the app; they
  don't yet see `receivedAt`, so one with a tight window may refuse a kept delivery.
- The Node relay needs an HTTPS front (Fly and Render give one; Caddy or Tailscale
  Funnel on a box of your own). `install.sh` is fetched from the release tag over
  HTTPS; its files aren't checked against hashes Conch holds.
- The Worker target is covered by the core's tests and a Durable Object storage
  adapter tested in memory, not against workerd itself.
