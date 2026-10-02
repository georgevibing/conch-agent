# 0044 — iMessage and email: channels through accounts that are already yours

- Status: accepted
- Date: 2026-10-02

## Context

ADR 0018 made a channel a bot you own, reached outward, with nobody let in
until you say so. iMessage and email don't have bots. On iMessage the only
account is the Apple ID on the Mac; on email it's your own mailbox. Both
are what people use most on their phones, and neither needs a developer
portal, which is why they're asked for.

How others reach iMessage and email (not re-tested here):

- iMessage bridges either read `chat.db` and send with AppleScript (the approach taken here), run a companion server on the Mac (BlueBubbles), or load a helper into Messages, which on some macOS versions means turning System Integrity Protection off. The last two break with macOS updates and ask people to lower their Mac's security.
- Email agents usually poll IMAP for any new mail and take the From line as written, or use Gmail's push notifications, which need a public endpoint.

What the platforms allow:

- **iMessage**
  - Messages keeps everything in `~/Library/Messages/chat.db` (SQLite, WAL). macOS hides it behind **Full Disk Access**: without it, opening fails while the folder is plainly there (`stat` works, `open` doesn't), so "not allowed" and "never used" can be told apart.
  - Since Ventura, `message.text` is often empty and the words are only in `attributedBody`, an `NSAttributedString` archived as a NeXTSTEP `typedstream`. The string follows the `NSString` class name as a `+` entry with a length prefix (one byte; `0x81` + 16 bits; `0x82` + 32 bits).
  - `message.date` is nanoseconds since 2001 since High Sierra (seconds before): too large for a JavaScript number, so it's divided in SQL.
  - Sending: Messages' AppleScript (`send … to participant … of account` / `to chat id …`). The first send asks the person once (Automation, error -1743 when refused). There's no API for typing indicators, edits or buttons.
  - Texting yourself on a Mac with your Apple ID files each message in the chat whose identifier is your own address, sometimes twice (sent and received), and Conch's own answers land there too.
- **Email**
  - IMAP IDLE gets new mail pushed over a connection the computer opens, so nothing is exposed; SMTP sends.
  - Gmail and Fastmail deliver `you+tag@` to you; iCloud doesn't (only three aliases, made by hand). Gmail needs 2-Step Verification before it shows **App passwords**.
  - Microsoft ended basic authentication (passwords and app passwords) for Outlook.com IMAP and SMTP on 16 September 2024; only OAuth 2.0 works.
  - Conch's Google sign-in (ADR 0037) needs each installation to register its own OAuth client and asks for `gmail.readonly`/`gmail.compose`. IMAP needs `https://mail.google.com/`, a restricted scope with full mailbox power.
  - The From line is whatever the sender wrote. The receiving provider records what it checked in `Authentication-Results` (RFC 8601), prepended above everything the sender wrote; a sender can add headers of the same name below it.

## Decision

**Two channels through accounts that are already yours.** They plug into
ADR 0018's service unchanged in shape, with a few declared capabilities on
`ChannelAdapter` that any later channel can use:

- `owner()`: who the owner already is. Connecting lets them in, with no hello.
- `quiet`: the account is the person's own, so an answer would come from them. Strangers and groups never hear back; strangers are still listed, quietly.
- `ChannelEvents.cursor` / `ConnectOptions.cursor`: how far it has read, kept with the channel (`channels.json`), so a restart answers nothing twice.
- `ChannelMessage.outside`: someone else's words even from the owner (a forward). It taints the chat (ADR 0028).
- `ChannelMessage.fresh`: a new email thread starts a new conversation, as `/new` would.
- Health can carry `access` (`full-disk-access`, `automation`): a macOS switch only a person can turn on, shown on the card and in Repair everything.

**Questions are answered with a word** (`channels/answers.ts`). Neither app has
buttons, so a question ends "Reply **yes** to allow it, **always** …, or
**no**", and a reply that is only that word (a full stop or 👍 is fine)
presses the button, while the question is open, in the chat it was asked
in. Anything longer is a message. The press still goes through the service,
so only people let in can answer.

### iMessage (`channels/imessage.ts`, Mac only)

- **Reading**: `chat.db` opened read-only with Node's own `node:sqlite`, polled every second by `ROWID` (cheap: the primary key). Reactions and group events are skipped; `attributedBody` is decoded where `text` is empty (`typedstream.ts`), and gives up rather than guess on anything that doesn't add up. A restart picks up from the last row read, answering texts up to a day old.
- **Sending**: a fixed script file (`assets/messages-send.applescript`) run as `osascript <file> <words> <target> <kind>`. The words are only ever an argument: never part of a script, never through a shell. With a program file first, osascript stops reading options, so words like `-e do shell script …` are data (tested against the real `osascript`). A chat the Mac deleted falls back to the person's address.
- **Two ways in**, chosen on the connect page with the addresses Messages itself uses (nobody types one unless Messages has never sent anything):
  - **I text myself** (recommended; the Mac shares your Apple ID). Only the chat whose identifier is your own address is read: nobody else can write there, and every other conversation on the Mac is never looked at. Your texts may be filed twice; each is read once. Conch's own answers are recognised and never read back.
  - **This Mac has its own Apple ID** (a little computer, ADR 0029). Only one-to-one texts from others count; nobody is answered until let in.
- **Full Disk Access**: the page names the app macOS asks about (Terminal, iTerm, or `node` for the background service, with **Show it in Finder**), opens System Settings at Full Disk Access, and polls; the channel does the same and carries on by itself once it's on. Automation refused shows on the card and clears on the next send that works.
- **Pictures**: only files under `~/Library/Messages/Attachments` (real path checked), HEIC turned into JPEG with macOS's own `sips` so every provider can see them.
- Elsewhere the tile says **Only on a Mac** (`catalogFor`), and `GET /api/channels/imessage` says `not-mac`.

### Email (`channels/email.ts`)

- **Transport**: IMAP IDLE with `imapflow`, SMTP with `nodemailer`, both TLS only (SMTP 587 must upgrade). Presets for **Gmail**, **iCloud** and **Fastmail** with app passwords and a button to the page that makes one; **Other** takes server names. **Outlook** says up front that Microsoft only takes its own sign-in now, rather than failing at the password.
- **Not Google sign-in.** Reusing ADR 0037 would need every person to register a Google OAuth client and grant `mail.google.com`, the full-mailbox restricted scope, to Conch. An app password is two minutes, can be revoked on its own, and Conch reads only one address with it.
- **Only mail for Conch, decided by address, not folder.** A `+conch` address works from every mail app with no filter to set up and no folder to choose, and keeps everything else in the inbox out of reach: Conch's searches ask the server only for mail to that address from the last day. Mail it handled is moved to a **Conch** folder (a label in Gmail), so the inbox stays yours. A folder people file mail into was rejected: it needs a rule in each provider, and anyone's mail can land there. iCloud, which drops `+` addresses, reads mail you send yourself with "Conch" at the start of the subject, or replies to Conch.
- **Who sent it** (`mail-read.ts` `senderVerdict`). The From line counts only when the provider's own `Authentication-Results` says so: DMARC passed for the From domain, or DKIM or SPF passed for a domain aligned with it (relaxed alignment, organisational domain from the Public Suffix List). Only headers signed with the provider's own server names count, and of those only the topmost for each: the provider writes its own above anything the sender did. Two From lines fail. Your own mail, which providers often don't check when you send it yourself, also counts when the same Message-ID is in your Sent mail (only you can put it there). Anything else is left in the inbox, unread by anyone.
- **Never a loop**: lists, auto-replies and bounces (RFC 3834 `Auto-Submitted`, `List-Id`, `Precedence`) are never read, Conch's answers carry `Auto-Submitted: auto-replied` and a `<conch.…>` Message-ID it skips, and replies to strangers are never sent.
- **Answers** go in the thread (In-Reply-To, References, "Re:"), from your address with **Reply-To** set to the `+conch` address so your reply comes back to Conch; plain text with a simple HTML part (`toEmailHtml`: inline styles, nothing loaded).
- **Reading what was written**: HTML as text without loading anything (`html-to-text`); the quoted thread (in several languages, Gmail's and Apple Mail's quote blocks, Outlook's header block), `>` lines and signatures dropped. A forward is kept whole and marked as someone else's words. Attachments (25 MB each) are held for ten minutes for the conversation to take.
- **Healing**: IDLE renewed every four minutes; news that arrives while Conch is looking gets another look; a drop reconnects with backoff; a new UIDVALIDITY starts from now; a refused app password stops only that channel (`needs-token`), and pasting a new one alone (`PUT …/token` with just `{ kind: 'email', password }`) brings it back.

### What else plugs in

- Secrets stay in `channels.secrets.json`, sealed with the device key (ADR 0025) and `secret` in the backup manifest; an email's app password is listed in Passwords as a system key. iMessage keeps no secret: the Mac already has the account.
- Repair everything: the channels check names **Turn on Full Disk Access**, **Let Conch use Messages** or **Paste a new app password**.
- `setup/known.ts`: `messages-app` (comes with macOS; opens Messages to sign in).
- `POST /api/channels/imessage/open` opens one of four fixed places (System Settings' two pages, Messages, Node in Finder), and only for a request from this Mac.
- ⌘K finds both by the words people use (`APP_WORDS`: gmail, iphone, text…).

## Security

- **Who can reach it**:
  - iMessage: anyone who can text you. In "text myself" only your own devices can write in the chat that's read; elsewhere, strangers are listed and never answered.
  - Email: anyone can send mail to `you+conch@`. It's read only when the provider vouches for the sender; a let-in person's words are untrusted (ADR 0028) like on every channel, and their questions go to you in Conch.
  - A forged sender (`From:` you, with its own `Authentication-Results: …dmarc=pass` below the provider's `fail`) is dropped: tested.
- **The agent can't let anyone in, or connect an account**: there's no tool; connecting and letting in are HTTP routes that need a fresh sign-in from another device (ADR 0018).
- **No shell, no script built from text**: osascript's arguments are fixed but for the words, after a program file. Opening System Settings takes one of four fixed places.
- **Read-only Messages**: the database is opened read-only; attachment paths from it are checked against Messages' own folder after resolving links.
- **The app password** is never returned, logged or put in an error (`redact`); TLS is required to every mail server (only the pretend one in tests is plain, and only through the mock engine's endpoints).
- Tests: `imessage.test.ts` (only the self-chat, echoes, approvals by word, path escapes, Full Disk Access, Automation, osascript argument safety), `email.test.ts` (forged, failed and unchecked senders, Sent-mail proof, loops, threads, revoke, UIDVALIDITY), `mail-read.test.ts`, `personal.test.ts` (end to end through the service), `routes.test.ts`.

## Consequences

- iMessage needs Conch running on the Mac, with Full Disk Access for whatever started it. If that's Terminal, macOS may ask to quit and reopen it once. Texting yourself only works when the Mac shares your Apple ID; a Mac with its own Apple ID works as a separate contact.
- What was verified on a real Mac (macOS 26, October 2026): opening chat.db without Full Disk Access fails while `stat` succeeds (how access is told apart), the send script compiles against Messages' own dictionary, and osascript passes `-e …` after a program file through as data. Reading a real chat.db's rows and sending a real iMessage were **not** verified (no Full Disk Access on the build machine, and nothing is ever sent from tests); the queries and the `typedstream` layout follow Messages' published schema and imessage-exporter's documentation of the format.
- Email was verified end to end against a pretend IMAP/SMTP server driven by the real `imapflow` and `nodemailer`, not against Gmail, iCloud or Fastmail themselves; the presets' servers and app-password pages come from each provider's help pages.
- Outlook.com waits for a Microsoft sign-in (OAuth with a registered public client). So does Gmail without app passwords (Workspace accounts whose admin turned them off).
- New dependencies: `imapflow` 2.2 and `nodemailer` 10 (MIT, the same maintained project, no native code). Parsing reuses `postal-mime` and `html-to-text` (ADR 0037); `tldts` gives the organisational domain.
- Pretend Messages (`channels/mock/imessage.ts`: a real chat.db written in WAL mode while Conch reads it) and a pretend mail service (`channels/mock/email.ts`: IMAP, SMTP and `/__control`) start with the mock engine; `CONCH_MOCK_IMAP_PORT`, `CONCH_MOCK_SMTP_PORT`, `CONCH_MOCK_MAIL_PORT` and `CONCH_MOCK_MESSAGES_PORT` ask for ports. The e2e journey is `channels-mail`.

## Sources (reviewed 2026-10-02)

- [RFC 8601, Authentication-Results](https://www.rfc-editor.org/rfc/rfc8601) (§5: receivers' own header, forged ones below)
- [RFC 7489, DMARC](https://www.rfc-editor.org/rfc/rfc7489) (identifier alignment)
- [RFC 3834, automatic responses](https://www.rfc-editor.org/rfc/rfc3834)
- [RFC 2177, IMAP IDLE](https://www.rfc-editor.org/rfc/rfc2177); [RFC 5322 §3.6.4, threading](https://www.rfc-editor.org/rfc/rfc5322#section-3.6.4)
- [Microsoft: modern authentication needed for Outlook.com](https://support.microsoft.com/en-us/office/modern-authentication-methods-now-needed-to-continue-syncing-outlook-email-in-non-microsoft-email-apps-c5d65390-9676-4763-b41f-d7986499a90d)
- [Google: sign in with app passwords](https://support.google.com/accounts/answer/185833); [Apple: app-specific passwords](https://support.apple.com/en-us/102654); [Apple: iCloud Mail aliases](https://support.apple.com/guide/icloud/add-and-manage-email-aliases-mm6b1a490a/icloud); [Fastmail: app passwords](https://www.fastmail.help/hc/en-us/articles/360058752854)
- [imessage-exporter](https://github.com/ReagentX/imessage-exporter) (chat.db schema, `typedstream`)
- [Apple: Messages scripting dictionary](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/) and `osascript(1)`
- OWASP ASVS 5.0 V5 (validation) and V14 (secure communications); Greshake et al., 2023, on indirect prompt injection (why a forward taints the chat)
