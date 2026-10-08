# 0099 — Many Google accounts, each with read or write access

- Status: accepted
- Date: 2026-10-06

## Context

Google was connected, but not manageable. ADR 0037 brought accounts to Conch,
ADR 0040 guided the Google Cloud setup and ADR 0048 made Gmail, Calendar and
Drive ordinary apps with an app-password path for Gmail. Four things were still
wrong for the person using it:

- **One account at a time, in practice.** The store kept several, but the only
  list was a stack of buttons inside a sign-in view ("Use this account",
  "Reconnect for this job"). Nothing said which account served which app.
- **Read-only without saying so.** Every capability was a read, except Gmail's
  draft. An app password could actually do everything in Gmail over IMAP; Conch
  simply never sent. A person who wanted their assistant to answer an email,
  move a meeting or write a document could not say so anywhere.
- **No way to ask for more.** "Capabilities" were decided by whichever job
  started a sign-in. There was no place to see what Google had allowed, let
  alone to raise it.
- **Unstyled chrome.** The credential file arrived through a bare
  `<input type="file">` and a password field labelled "Or paste credential
  JSON", inside a four-step console guide, inside a connect dialog.

## Decisions

### Access is a level per product per account

A product is `gmail`, `calendar` or `drive`; a level is `off`, `read` or
`write` (`@conch/protocol` `GoogleProduct`, `GoogleAccess`, `GoogleLevel`).
Write includes read. The capabilities a tool asks for are derived from levels
(`capabilitiesFor`, `accessOf`), so one list of scopes stays the source of
truth and no caller invents a scope.

Each account now carries two maps: `granted`, the most its sign-in allows, and
`access`, what the person chose, held under `granted` (`accountsOf` in
`google/service.ts`). `capabilities` is `access` expanded, so every existing
reader — the apps, the prompt, routines, the model's `google_accounts` — sees
exactly what Conch may do and nothing wider. The person's choice lives in
`limits` in the sealed store, beside the credential it bounds.

`setAccess` refuses a level above `granted` with `consent`, which the web app
turns into one Google sign-in for that account, asking for everything it
already has plus the one new thing (Google does not support incremental
authorization for installed apps, ADR 0040). Lowering never needs Google.
Raising within `granted` still needs a recently verified session, like every
other grant of reach; lowering does not.

### Writes exist, and every one asks

Gmail can send, Calendar can add, change and delete an event, and Drive can
make a file (`google/writes.ts`). Scopes stay the narrowest that do the job:
`gmail.compose`, `calendar.events`, and `drive.file` beside
`drive.metadata.readonly` — Conch can only touch files it made itself.

Every write asks the person, every time, with the account and exactly what
will happen, whatever the app's policy says (`alwaysAsks`; the server refuses
`allow` for them). The account's scope identity is read before the question and
again after it: a sign-in, a revocation or a level the person lowered while the
card waited stops the write, and nothing is done. `SATISFIED_BY` lets a broader
scope Google already granted satisfy a job, so nobody is asked twice.

`service.api` no longer allows any POST that isn't Gmail's draft: each write is
one row of `WRITES` with the single capability it needs, matched on method and
path. A draft token cannot send, and a path that matches no row is refused
before any credential is read.

### A write that might have happened is found, never repeated

Each write derives its own identity from the durable operation id, so looking
for it is possible and repeating it is not:

- A calendar event is created with `id = eventIdFor(operationId)`, so Google
  itself rejects a second attempt (409 is read as "mine, already there").
- A sent email carries `Message-ID: <conch.…@sender's domain>`; it is found by
  `rfc822msgid` in Sent, or over IMAP in All Mail for an app-password account.
- A Drive file carries `appProperties.conchOperation`.
- A change or a deletion is idempotent in Google's own terms: reconciliation
  reports `absent` only when applying it again cannot do harm (the same fields,
  the same deletion), and `unknown` otherwise.

A 4xx from Google is `not-executed` — nothing happened. A transport failure,
a 5xx or an unreadable body on a write is `ambiguous` and is never retried
(ADR 0037's rule), with words that say to look before trying again.

Sending with an app password goes over SMTP to `smtp.gmail.com` with TLS only
(`GmailImap.send`, the pretend mail service on 127.0.0.1 in tests). Failures
before the message is handed over are "nothing was sent"; after, `SendUncertain`
and Sent is the only proof.

### Accounts, as a list a person can manage

Nacre gained two patterns:

- `AccountAccessCard` / `AccessLevels` (`patterns/Integrations/`): one card per
  account — who, how it's signed in, its state in words — then a row per
  product with Off · Read · Read & write, what the current level means under
  it, and the problem with its one fix first when something needs the person.
  A product an account cannot reach (Calendar on an app password) says why and
  offers the button that changes that, never a control that would pretend.
- `FileDropZone` (`patterns/Attachments/`): one file dropped, chosen or pasted,
  for a credential a person downloaded somewhere else. The unstyled file input
  and the "Or paste credential JSON" field are gone.

The web app has one "Google accounts" section, the same on all three app pages
(`GoogleAccounts.tsx`), with the current app's row marked. Adding an account is
a guided flow: what it should help with, then the simplest way to connect for
that — an app password when it's Gmail alone and there is no Google app yet,
Google sign-in otherwise — with the trade-off in one line, then connecting.
A Google sign-in for an address that was connected with an app password
replaces it, so there is one entry per address.

### What the model gets

`google_accounts` lists each account's email, state and level per product, and
every tool takes `accountId` as an email (or an id). Left out, the one account
that can do the job is used; with several, the tool names them and asks for a
choice; with none, it says the person can allow it in Apps. A tool whose
capability the person didn't grant is not offered at all, and a call that
reaches further is refused with words a model can act on, never by trying.

## Security

- The person's levels live in `google.secrets.json`, beside the credential they
  bound, under the same device sealer, protected paths and secret-only backup
  rule. Nothing new is written anywhere else. The browser never learns a token,
  an app password or a client secret.
- An account's access travels only with its own sealed credential: a backup
  preview cannot open sealed files, so a restored account comes back with the
  very sign-in and the very levels it had, and a backup cannot grant more than
  it carried.
- A raise is a human action in the UI with a verified session; the agent has no
  tool that can change a level, and `setAccess` is the only way one moves.
- Writes bind account, arguments and scope identity, and are approved one at a
  time (`once`), with taint and skill restrictions on the same card.
- Addresses are validated emails, subjects cannot hold a line break, bodies are
  base64, reply ids are checked tokens: no header can be injected into a draft
  or a sent message. `multipart/related` for Drive uses a random boundary and
  text parts only.
- Fixed Google hosts only, no redirects, bounded bodies, 20-second timeouts.

## Migration

A store written before this (no `version`) is brought up to date as it is read
(`migrateGoogle`): every account keeps exactly what it could do — Gmail that
could save drafts becomes Gmail's write level — and `google_mail_send`, which
did not exist, starts `off` in Gmail's tools, so no older setup can newly reach
out before a person turns it on.

(Amended by [ADR 0104](./0104-gmail-sends-when-it-says-it-can.md): that "off" showed as
the person's own choice and stopped Read & write accounts from sending, so store
version 3 takes it back out.)

## Verification

`google/access.test.ts` covers levels under grants, the `consent` refusal, the
app-password ceiling, replacing a password account with a sign-in, the
migration, picking an account among several, and each write: one question, the
exact request, the stopped write when access changes mid-approval, the event
found instead of made twice, and sending over the pretend SMTP service. The web
and Nacre tests cover the accounts list, the raise flow, the drop zone and the
guided add. No real Google account, email or network is part of any of it; a
real account's consent and API access remain external acceptance steps.

This extends ADR 0037, ADR 0040 and ADR 0048 — their credential, approval and
durable-effect contracts hold unchanged.

## Sources (checked 2026-10-06)

- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)
- [Gmail IMAP and SMTP settings](https://support.google.com/mail/answer/7126229)
- [Google app passwords](https://support.google.com/accounts/answer/185833)
- [Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Calendar events.insert (own ids)](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Drive API per-file scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive multipart upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google incremental authorization](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth)
- [OWASP OAuth2 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)
