# 0043 — WhatsApp and Signal: your own account, linked by QR code

- Status: accepted
- Date: 2026-10-02

## Context

ADR 0018 made a channel a bot you own, and listed WhatsApp and Signal as
coming. Neither has a bot you can make in two minutes:

- **WhatsApp** has two ways in.
  - The official **WhatsApp Business Cloud API** needs a Meta business
    account, a verified business, a phone number given up to the API (it
    can't stay on a phone), per-conversation pricing, and **webhooks**: Meta
    delivers every message to a public HTTPS address. There is no outbound
    way to receive.
  - A **linked device**, as WhatsApp Web does. The open-source library
    Baileys (`@whiskeysockets/baileys`, MIT) speaks that protocol; it's what
    OpenClaw's WhatsApp channel uses, and how most self-hosted assistants
    reach WhatsApp. WhatsApp's terms allow only its own clients and forbid
    "automated or unauthorized means" of access, and WhatsApp can restrict
    or ban numbers it judges automated. In practice that falls on bulk
    senders, rarely on a number one person uses, but the risk is real.
- **Signal** has no bot API at all. Its own clients are the only official
  ones. signal-cli (GPL-3.0, Java, maintained since 2015) is the
  long-standing unofficial client, used by OpenClaw, Hermes and
  signal-cli-rest-api; it links as a device (`sgnl://linkdevice?…` shown as
  a QR code) and has a JSON-RPC mode for programs. The alternatives are
  worse: presage (Rust) ships no binary to install; libsignal's Node
  bindings are only the protocol, not the service, storage and
  provisioning around it.

What OpenClaw does (September 2026): `openclaw channels login` prints the
WhatsApp QR in a terminal; a "self-chat mode" lets you talk to yourself, and
an allowlist (`allowFrom`) decides who else is answered. Its docs recommend a
spare number. Signal needs signal-cli installed and a number typed in.

Linking a device changes what a channel is. The account is not a bot: it's
**you**. Everyone who writes to that number is writing to you, your groups
are your friends', and an assistant that answered them would speak as you.

## Decision

**WhatsApp and Signal link your own account as a device** (Baileys,
signal-cli), and are channels like the others: same conversations, same
relay, same approvals, same healing, same Channels page.

**Linking is the hello.** The setup page shows a code at once beside a
picture of the phone's **Linked devices** screen and the taps to make
(Nacre `DeviceLinkCard`, `LinkedDevicesSketch`). The code changes by itself
(WhatsApp: a minute, then every 20 s; Signal: two minutes, replaced up to
three times), so there's nothing to press in Conch. Once scanned, the card
says "Scanned" while the phone finishes, then the channel exists and its
owner is the account itself: only someone holding the phone could scan it.
`ChannelLinking` (`channels/linking.ts`) runs one link per app at a time;
codes stream to the page as `channel.link` events, are never logged or kept,
and leave the link record once it ends. Leaving the page stops a code that
was still showing.

**You talk in the chat with yourself** — WhatsApp's **Message yourself**,
Signal's **Note to Self** — from your phone or any of your devices.

- **Other people who write to you are never read** (`settings.others:
'ignore'`, the default): no request, no reply, nothing stored. A number
  just for your assistant can be switched to `ask`; then strangers get the
  polite reply and wait to be let in, exactly as ADR 0018, and what they
  write is untrusted (ADR 0028).
- **Groups never hear from it**, not even ADR 0018's "I only talk in
  private chats" hint, which would post into your friends' groups.
  "Answer when mentioned" was considered and left out: a mention in a group
  is a mention of you, and anyone in the group could speak for you.
- **Your own messages to other people** are none of Conch's business, and
  nothing before the link, or more than a day old, is answered. History
  sync is off: Conch never reads your past chats.
- **Two Conches on one account never answer each other**: Conch's WhatsApp
  messages have ids starting `C0C4`, and its Signal messages end with an
  invisible separator (U+2063); both are skipped when they come back.
- **Your profile is left alone**: no name, picture or "online" change.
  WhatsApp is connected with `markOnlineOnConnect: false` so the phone
  keeps its notifications.

**No buttons.** Neither app gives a linked device buttons, so a question
ends with numbered answers (`Reply with a number: 1 Allow · 2 Always in this
chat · 3 Don't allow`), and a reply of `1`, the answer's words, or a plain
yes or no presses it (`TextChoices`). A reply quoting a question answers
that one; otherwise the newest. Commands (`/stop`) and sentences are never
answers. The question is then edited to say what was decided, as on
Telegram.

**Formatting and the rest.** WhatsApp gets `*bold*`, `_italic_`, `~strike~`
and code; Signal gets plain text with style ranges (`textStyle`, UTF-16
offsets, private-use markers so text can't forge one). Answers are cut at
4,000 characters (WhatsApp) and 1,900 (Signal). Typing shows to others;
in the chat with yourself a 👀 reaction marks the message being worked on,
taken off when done. Photos, files and voice notes become attachments (up
to 25 MB).

**Healing** (AGENTS.md agreement 11):

- **WhatsApp**: the "restart required" after linking reconnects at once;
  drops and timeouts retry with backoff; another copy of the same link
  taking over twice in five minutes is named (`conflict`) and waited out; a
  device unlinked on the phone (`401`) or a session WhatsApp can't read
  (`500`, `411`) stops that channel and asks to **Link again**; a number
  WhatsApp refuses (`403`) says so.
- **Signal**: signal-cli is started again with backoff when it stops, and
  the channel shows reconnecting meanwhile; missing signal-cli or Java
  becomes a need (`ChannelHealth.need`) with **Install**, in the setup, on
  the channel's page and in Repair everything, and installing it tries again
  (`Services.needLanded`); an unlinked device asks to link again (checked on
  every start and every ten minutes).
- **Linking again** must be the same number; another number is refused and
  its fresh keys deleted.

**Installing** (ADR 0016, `setup/known.ts`): `signal-cli` (Homebrew on
macOS and Linux, which brings Java; on Windows its release, linked) and
`java` (Java 25 or later: winget Temurin 25 JRE, Homebrew `openjdk`). A
Mac's `/usr/bin/java` stub doesn't count: a Java counts only when its
`-version` says 25 or more. On Windows the release has only a batch file,
which Conch never runs (a shell would read the arguments); it reads the
batch file's class path and starts Java itself.

**Cloud API: not now.** It can only receive through a public webhook, which
ADR 0018 rules out ("an app that only offers webhooks waits"); it also
needs business verification and takes the number off the phone. It isn't
cheap to add, and it isn't for a person's own number.

## Security

- **Who can reach it**: WhatsApp's and Signal's servers, carrying
  messages from anyone who has your number. Only the account's own
  messages in the chat with yourself reach a conversation by default.
  The checkup's `channel-people` and `channels-full-trust` cover these
  channels as they do bots.
- **The agent can't link anything.** Showing a code (`POST
/api/channels/link`) is a trust route: from another device it needs a
  password or key from the last ten minutes, because whoever scans the code
  links their account to your assistant. `POST /api/channels` refuses a
  WhatsApp or Signal "session" posted as if it were a key, so nobody can
  point a channel at keys they planted.
- **Keys**:
  - WhatsApp's device keys live in `~/.conch/whatsapp.secrets.json`, sealed
    under the device key like the other key files (`lib/sealed.ts`),
    gathered and written at most every 1.5 s (keys change with nearly every
    message), flushed on close.
  - signal-cli's files live in `~/.conch/signal` (0700), its own config
    folder, apart from any signal-cli you use yourself. They can't be
    sealed: signal-cli opens them itself while it runs, which is always.
  - Both are `secret` in backups (only with a passphrase), protected paths
    for the agent's own tools (`lib/protect.ts`), listed in Passwords
    without a value, and named in a restore's preview (`channel-people`).
    A restored copy is an old copy of a device: if WhatsApp or Signal won't
    take it, the channel asks to link again.
  - signal-cli runs over stdin/stdout, never a TCP port another local
    program could reach, with Conch's own environment variables removed.
- **Untrusted content**: people let in on a spare number are untrusted
  (ADR 0028), and a guarded question in their chat goes to you in Conch.
  Downloads come only through Baileys' media keys or signal-cli's own
  attachments folder (`safeJoin`, plain file names only).
- **What you can't control**: WhatsApp's enforcement. The setup says so
  plainly beside the code, and the docs suggest a spare number for anyone
  who couldn't do without theirs.
- Tests: `whatsapp.test.ts` and `signal.test.ts` (strangers and groups
  never read, echoes and other Conches ignored, unlinking, conflict, expiry,
  missing programs, the Windows launch), `routes.test.ts` (fresh sign-in,
  smuggled sessions, path-like ids), `linked.test.ts` (formatting, numbered
  answers).

Sources: WhatsApp Terms of Service § Acceptable use (2026); Meta's WhatsApp
Cloud API "Webhooks" and "Get started" guides; Baileys' README and
`DisconnectReason`; signal-cli's README, `jsonRpc` man page and JSON schemas
(0.14.8); OpenClaw's WhatsApp and Signal channel docs; OWASP ASVS 5.0 V13
(configuration and secrets) and V14 (data protection); Greshake et al.,
"Not what you've signed up for" (2023) for treating others' messages as
untrusted.

## Consequences

- WhatsApp takes about a minute and nothing to install. Signal takes about
  two, plus signal-cli and Java the first time (about 300 MB with Java).
- New dependency: `@whiskeysockets/baileys` 7.0.0-rc14 (the current
  `latest`; 6.x pulls libsignal from git and predates WhatsApp's private
  ids). It brings `sharp` as a peer for thumbnails, unused here. Its
  install scripts only check the Node version and print a notice, so
  `pnpm-workspace.yaml` declines them.
- Baileys is a reverse-engineered client: WhatsApp changes can break it
  until it's updated, and updating it is a Conch update. signal-cli is
  updated like any program Conch relies on (ADR 0019).
- Conch has to be running to answer. Messages sent while it was off arrive
  when it reconnects and are answered if they're less than a day old.
- With the mock engine, a pretend WhatsApp (at the Baileys seam,
  `channels/mock/whatsapp.ts`) and a pretend signal-cli (at the process
  seam, so the real JSON-RPC client runs, `channels/mock/signal.ts`) start
  too; `GET /api/channels/mock` says where their `/__control` endpoints are.
  The e2e journey is `e2e/channels-linked.spec.ts`.
- Checked against the real services without linking an account: Baileys
  produced WhatsApp's QR codes through Conch's own transport, and the real
  signal-cli 0.14.8 (with Temurin 25) produced a `sgnl://linkdevice` code
  through Conch's JSON-RPC client, and timed out unscanned as expected.
  Everything after a real scan (receiving, sending, editing, reactions,
  unlink codes) is built from the libraries' types and documentation and
  tested against the pretend apps only.
