# 0048 — Google apps as apps, and Gmail with an app password

- Status: accepted
- Date: 2026-10-02

## Context

ADR 0037 connected Google accounts to Conch directly and ADR 0040 made the
Google Cloud setup bearable, but Google still wasn't an app on the Integrations
page. A box at the top asked "What would you like to do with Google?", the
accounts lived in their own store, so Gmail, Calendar and Drive stayed in the
gallery after connecting, with no card, switch, per-tool choice, health or
place in the prompt. And every Gmail user had to create a Google Cloud project.

What Google allows (checked 2026-10-02):

- Gmail over IMAP takes an **app password** once 2-Step Verification is on
  (support.google.com/accounts/answer/185833). Gmail's IMAP extensions give
  its own search (`X-GM-RAW`, the same words as the search box) and ids
  (`X-GM-MSGID` is the Gmail API's message id in decimal, `X-GM-THRID` its
  thread). `APPEND` with `\Draft` into the Drafts folder makes a draft
  (RFC 3501, RFC 4315 `APPENDUID`). Without SMTP nothing can be sent.
- Google Calendar's CalDAV and the Drive API need OAuth: no app passwords.
- Workspace administrators can turn app passwords off; such accounts use the
  Google Cloud way.

## Decision

**Gmail, Google Calendar and Google Drive are integrations** (`GoogleApps`,
`google/apps.ts`). Each is an `Integration` with `transport: { type: 'host' }`,
made from the sealed Google store rather than `integrations.json`, joined into
`IntegrationService` (`hosted`): listed, opened, switched, checked, removed,
in the prompt's integrations section, issue cards and Repair everything, and
found by ⌘K. One Google account serves all three; each asks Google only for
its own capability (incremental consent as before). The store keeps per-app
settings beside the accounts: on/off, policy, per-tool policy, hidden after a
disconnect. Credentials stay where ADR 0037 put them.

**Choices are held in the tools, on every engine.** The tools are Conch's host
tools (same names and shapes as ADR 0037). A tool that's off, or an app that's
off, isn't offered to the model at all; `IntegrationService.decide` says `off`
for the guard as well. Ask asks before running. Saving a draft keeps ADR
0037's own approval (account, arguments and consent bound and checked again
before the write), so it is **Ask or Off only** (`alwaysAsks`); the server
refuses Allow.

**Gmail's default is an app password.** `GmailImap` (`google/imap.ts`) talks
IMAP to `imap.gmail.com:993` with TLS only (a pretend server on 127.0.0.1 in
tests), reusing the email channel's connection and error words
(`channels/imap.ts`). Search, read and drafts map onto the same tools: a draft
gets Conch's deterministic Message-ID, is APPENDed to the folder Gmail marks
`\Drafts`, and is a receipt only when exactly one draft with that Message-ID
reads back with exactly the requested headers and body. A failure before
APPEND went out is "nothing was saved"; after, it's ambiguous and never
repeated (ADR 0037's rule). Threading of a reply is carried by In-Reply-To and
References; Gmail's thread id isn't required to match on this path. There is
no SMTP here. Calendar and Drive say plainly they need the Google Cloud way.
"Use your own Google Cloud app" stays as Gmail's advanced path.

## Security

- The app password comes in once, in a POST body that needs a recently verified
  session, is checked by signing in before anything is kept, and is rate-limited
  (ten tries in ten minutes). It's sealed in `google.secrets.json` (already in
  `SEALED_FILES`, protected paths and the backup manifest as `secret`), never
  returned, and taken out of anything the server says before it's read. It
  shows in Passwords as Gmail's, like the email channel's.
- The email channel's Gmail sign-in is offered for Gmail, never shared without
  a person pressing **Use it for Gmail** (verified session); the browser only
  ever learns the address.
- Fixed hosts only: no address comes from the person, the model or a message,
  so there is nothing to point elsewhere (no SSRF surface).
- Drafts reuse ADR 0037's builder: addresses are validated emails, the subject
  can't hold a line break, the body is base64, reply ids are checked tokens, so
  no header can be injected.
- An app-password account can't send at all, which is narrower than Google's
  `gmail.compose`.

## Self-healing

A refused password marks the account `needs-auth`: the Gmail card says so with
**Sign in again**, and its page has the field to paste a new one. A blip
retries reads twice with a pause, never a draft; a check that can't reach
Google is tried again at 30 s, 2, 10 and 30 minutes, and coming back leaves a
"fixed on its own" note. Accounts are looked at after start-up and every half
hour.

## Consequences

The Google box is gone; each tile opens its own dialog. Disconnecting one app
keeps an account another Google app still uses, and revokes it at Google when
none do. Tested against the pretend mail service, which now speaks Gmail's
IMAP extensions and APPEND (unit and e2e); a real Gmail account wasn't used.
