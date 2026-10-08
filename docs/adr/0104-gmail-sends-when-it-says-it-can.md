# 0104 — Gmail sends when it says it can

- Status: accepted
- Date: 2026-10-08
- Amends: [ADR 0099](./0099-many-google-accounts-and-write-access.md) (its migration, and
  "every write asks"), [ADR 0048](./0048-google-apps-and-gmail-app-password.md) (drafts are
  Ask or Off only)
- Builds on: [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0100](./0100-permission-modes-every-provider.md) (Auto and Full trust)

## Context

A person connected Gmail with an app password, set it to **Read & write** ("Also save
drafts and send email"), and asked their assistant to send an email. It said it could
only save a draft. The page agreed with neither: **Send an email** showed **Off** with an
orange dot, and the text above it said "nothing is ever sent".

Why it refused, in order:

1. **ADR 0099's migration turned sending off by itself.** A store written before
   per-account access got `google_mail_send: 'off'` in Gmail's tools, so no older setup
   could newly reach out. Nobody chose that, but the page showed it as the person's own
   change (the orange dot means "you changed this"), and it outlived the store's
   upgrade: the account said Read & write, the tool was off, and the tool was never
   offered to the model (`GoogleApps.decide` → `off`).
2. **The model was told it couldn't.** With the send tool hidden, the only Gmail write
   it had was the draft, whose description says it never sends; the prompt's Gmail line
   said nothing about sending at all.
3. **The words contradicted each other.** "Saving a draft always asks … and nothing is
   ever sent" predates sending (ADR 0048), and "It asks you every time" on the account
   wasn't true in Auto or Full trust.

Sending itself was already there for both ways of signing in: SMTP to `smtp.gmail.com`
with the app password (`GmailImap.send`, ADR 0099) and Gmail's `messages.send` with
`gmail.compose` for Google sign-in. What was missing was the truth, files, a choice of
sender, and a way for a person to say "don't ask me".

People also read **Off** as "send without asking". A control whose words can be read
backwards is a safety problem of its own.

## Decisions

### One truth: an account that can send, sends

- **The migration's "off" is taken back.** Store version 3: a version 2 file's
  `google_mail_send: 'off'` is removed, so sending follows the account's level and asks
  first like every new setup. A file older than version 2 is brought up without it. A
  choice made on the page since version 3 is the person's and stays. (A person who
  turned sending off by hand between ADR 0099 and this one is back at Ask, which still
  shows every email first — the safe side of the ambiguity.)
- **Read & write in Gmail means sending works**, with an app password or Google
  sign-in. The tools say so (`google_mail_send`'s description, `google_accounts`), and
  the prompt's Gmail line says either "it can send: send it, don't only save a draft",
  "the person turned sending off: say so", or "no account may send yet (read only): say
  how to allow it".
- **A setup that can't send says so on the account**: a Google sign-in that Google only
  allowed to read Gmail reads "Read only: this sign-in can't send", with **Read & write**
  (one Google consent) and **Use an app password instead**. An app-password account
  offers **Switch to Google sign-in**. Each account has one line for its method and what
  it reaches ("App password · Gmail: read and send. Calendar and Drive need Google
  sign-in."). Connecting an app password for an address that has a Google sign-in moves
  Gmail to the password (the sign-in's Gmail level becomes off; its Calendar and Drive
  stay), so Gmail has one account per address.
- A refusal is in words the model can pass on, with the way out: "…is set so Conch
  can't send email. The person can change that in Apps → Gmail → Google accounts (Read &
  write). Offer that, or a draft instead."

### Speaking for the person: Ask by default, Allow on purpose

`IntegrationTool.asksFirst` (protocol) marks a tool that speaks for the person:
**Send an email** and **Save a draft**. It replaces their `alwaysAsks`, which stays for
calendar changes, Drive files and Slack messages (Ask or Off only).

- **Default Ask, whatever the app's policy.** `toolDecision` and Nacre's
  `defaultPermission` give `asksFirst` tools Ask unless that one tool is set otherwise:
  "Don't ask" on the whole app never makes email go unshown.
- **Allow is a choice on that tool alone**, made in the UI (an agent has no tool that
  changes it). Choosing it says, inline, "Conch will send an email without showing you
  first." with **Undo**.
- **One rail no choice lifts:** under Allow, the email is still shown first when the
  chat has read anything from outside (`ctx.taints()` non-empty, or the guard's
  `untrusted()`), when a skill in use doesn't say it needs Google, or when Conch guessed
  the sender (no account named and several could send). Reading something and then
  sending it to an address is the classic exfiltration path for an injected prompt
  (Greshake et al., 2023); this is the case that must reach a person.
- **With the modes (ADR 0100), unchanged in spirit:** the question still goes through
  `ctx.ask` with `once`, so Full trust and Auto treat it exactly as before; a tool the
  person set to **Ask** is now sent as `explicit`, so Auto keeps asking, as the page has
  always said ("except for a tool you set to Ask"). Nothing here makes Auto stricter
  for anyone who didn't choose Ask.
- **Every choice says what it means** under the control: "Uses it without asking.",
  "Asks you each time.", "Doesn't ask. Still asks if the chat read something from
  outside.", "You turned this off. Conch can't use it." with **Turn on**. The unexplained
  orange dot is gone; "Reset … tools you changed" stays.

### Who it's from, and what it carries

- **From** is `accountId`: the account the person names. Left out with one account
  that can send, that one; with several, the first that can (Google sign-ins first,
  then app passwords, in the order connected) — and then the email is always shown,
  even under Allow.
- **Files** go by the chat's own attachment ids (`att_…`), read with the same
  `filesOf` that sends files to chat apps (`channels/outbound.ts`): another chat's file
  or a path is refused before anything is asked. At most ten, about 18 MB together
  (Gmail takes 25 MB after base64). The message is `multipart/mixed` with a random
  boundary; file names go in RFC 2231/6266 form; media types are checked to
  `type/subtype`.
- Over Gmail's API, an email up to about 3.5 MB goes as JSON `raw` (the 5 MB metadata
  limit, with base64's growth); a bigger one goes to the upload endpoint
  (`/upload/gmail/v1/users/me/messages/send?uploadType=multipart`), one more row in
  `WRITES` with the same `mail-send` capability.
- The card shows the exact email: **From**, To, Cc, subject, **Files** and the words,
  with **Send** and **Don't send** (`DraftReview kind="send"`).

## Security

- Allow is persisted only by a person in the UI (`PATCH /api/integrations/gmail`); the
  agent cannot set it. The rail after reading holds in every mode but Full trust, where
  ADR 0100's rules already apply (someone else's words still always ask).
- Attachments come only from the conversation's own store entries, never a path the
  model names; ids are `Id`-checked; sizes are bounded before anything is composed.
- No header comes from a file name or type: names are encoded, types allow-listed, the
  body and files are base64, the boundary is random and can't occur in base64.
- `google_mail_send` stays a sink (`taint.ts`), and the identity of a send now includes
  its files, so a retried operation can't swap them.

## Verification

`google/access.test.ts`: an app-password account at Read & write is offered sending and
sends over the pretend SMTP server with From, To, subject, body and a file by id; a
file from another chat is refused before asking; a Google sign-in sends through the
mocked API, and a big email through the upload endpoint; the named From is used and a
guessed one is shown even under Allow; Allow still asks after reading; the person's Ask
is explicit; a read-only setup refuses in plain words; version 2's own "off" is taken
back while a later choice stays; "Use an app password instead" moves Gmail. Nacre and
web tests cover the words under each choice, Allow with Undo, Turn on, the send review,
and the account lines. `e2e/google-apps.spec.ts` sends from an app-password account
through the pretend mail service after the review card. No real Gmail account was used:
sending through Google's real SMTP and API (and the upload endpoint's size limits)
remain external acceptance steps.

## Sources (checked 2026-10-08)

- [Gmail IMAP and SMTP settings](https://support.google.com/mail/answer/7126229)
- [Google app passwords](https://support.google.com/accounts/answer/185833)
- [Gmail messages.send, and uploads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)
- [Gmail attachment size limits](https://support.google.com/mail/answer/6584)
- [RFC 2231](https://www.rfc-editor.org/rfc/rfc2231), [RFC 6266](https://www.rfc-editor.org/rfc/rfc6266) (file names in headers)
- Greshake et al., "Not what you've signed up for: Compromising Real-World LLM-Integrated
  Applications with Indirect Prompt Injection" (2023)
