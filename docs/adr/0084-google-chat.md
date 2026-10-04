# 0084 — Google Chat: a Chat app of your own, through the public door

- Status: accepted
- Date: 2026-10-04
- Amends: [ADR 0045](./0045-teams-matrix-wechat.md) (the public door serves one more app)

## Context

Google Chat is where many schools and companies talk. What it offers a Chat
app (checked 2026-10-04, developers.google.com/workspace/chat):

- **Only a Google Workspace account can make a Chat app**, in a Google Cloud
  project with the Google Chat API on, configured on the API's
  **Configuration** page (name, what it does, how it's reached, who sees it).
- **Events go to an HTTP endpoint** (or Pub/Sub, or Apps Script). With the
  endpoint URL as the authentication audience, each request carries a
  Google-signed ID token in `Authorization`: RS256 with Google's published
  keys, issued by `accounts.google.com`, for the endpoint URL, about
  `chat@system.gserviceaccount.com`.
- **Answering later** than the request is a Chat API call as the app,
  authenticated with a service account's key: a JWT traded at Google's token
  endpoint for an access token with the `chat.bot` scope.
- **In a space** Chat only delivers what @mentions the app, with
  `argumentText` (the message without the mention). Buttons are card widgets;
  a click comes back as a `CARD_CLICKED` event, signed like the rest.

## Decision

**Google Chat is a channel like Teams** (ADR 0045), in
`channels/googlechat.ts`: an app of the person's own, through the public
door, answering through the Chat API with a service account's key.

- **The key** is the whole JSON key file, chosen on the page (the browser
  reads it; nobody types a path) or pasted. Conch checks it at once: the
  token exchange, then a Chat API call that says whether the API is on.
  Google's own failures become the step to take (the API off, no Chat app
  configured yet, a deleted key).
- **Nothing is read before the bearer token checks out**: `jose` verifies the
  signature with Google's keys, RS256 only, the issuer, the audience, the
  expiry, and the email claim (`chat@system.gserviceaccount.com`, verified).
  - **The audience** is this channel's own public address as the door was
    set up, never anything the request says about where it was sent (`Host`,
    `X-Forwarded-*`): a token minted for another Conch's address is refused.
  - **Google's keys** are cached six hours. Google is asked again for a key
    id it hasn't seen, or when they're old, but never more than once every
    five minutes, whatever arrives, so a flood of made-up key ids can't make
    Conch hammer Google. If Google can't be reached, what isn't known is
    refused: it fails closed.
- **A token isn't bound to the body**, and lasts an hour. So:
  - **each event is taken once**, claimed by the name Google Chat itself
    gives the message (read back, so the body can't vary it), in one
    synchronous step after the read-back (two copies arriving together
    can't both pass), and remembered on disk (`channels/googlechat-<id>.json`,
    `derived` in backups) for two hours, so a replay after a restart is still
    one event;
  - **an event's own time must be within five minutes of now**;
  - **who wrote what, and where, comes from Google Chat itself**: the
    message is read back with the app's own token (`spaces.messages.get`)
    and its space's kind with `spaces.get`, and only that copy is acted on.
    A forged body under a captured token names a message Google never had
    (nothing happens), or a real one whose sender and words are the server's,
    not the body's.
  - **An empty or plain-`http` audience, or no issuer, fails closed**, as does
    a token whose key Google can't be asked for.
- **The other way Google Chat signs**, for the project number as audience
  (tokens from `chat@system.gserviceaccount.com`, checked against its X.509
  certificates), is never accepted: Conch doesn't know the project number.
  A genuine one only makes the channel say, in plain words, to set
  **Authentication Audience** to **HTTP endpoint URL**.
- **Answers** are written in Chat's own marks (`*bold*`, `_italic_`,
  `<url|label>`), at most 3900 characters a message.
- **Approvals are numbered replies** (`TextChoices`), read like any message:
  from Google Chat's own copy, so the person answering is the server's
  sender. Card clicks aren't taken at all: who clicked is only ever in the
  posted body, which a captured token could carry forged. So an approval
  can't be replayed: the reply is claimed once by Google's name for it; it
  answers only the question still open in that chat (a decided, expired or
  superseded question stops taking answers); the question's own key is
  random, single-use and tied to its request and chat (ADR 0018); and a
  question from a group goes to your private chat, where only you write.
- **Groups** (ADR 0075): a space is answered once you turn it on, and only
  what mentions the app; everyone but you gets words only.
- **Files** sent in Chat aren't taken yet (downloading them needs another
  scope and a person's consent); the guide says so.
- **A replaced connection never speaks for the channel**: the service only
  takes a connection's state while it's still the channel's live one. Found
  while testing a deleted key here: the connection a repair replaced could
  report "online" as it closed, over the "needs a new key" just set.

`ChannelKind` and `ChannelSecrets` gain `googlechat` (`serviceAccount`), and a
pretend Google (`channels/mock/googlechat.ts`) signs ID tokens and service
account exchanges with keys of its own.

## Security

- **Who can reach it**: the internet, at the door, only with a token Google
  signed for this address. Tested (`googlechat.test.ts`): another key,
  another audience (another Conch's, or one claimed in headers), another
  sender, another issuer, an expired token, none, a flood of made-up key ids
  (at most one fetch), Google's keys unreachable (refused), a body claiming
  the owner wrote a member's message (the member it is), a replay of the
  same message (once, across a restart), a replay with a forged body
  (nothing), a stale or future event time, and a project-number token
  (refused, the setting named), two copies of one event at once (one turn),
  a forged body with a made-up message name, every kind of event without a
  valid token, a click claiming the owner's approval (ignored), and no
  address of its own (refused).
- **Who may act**: the owner is the Google user (`users/<id>`) who said
  hello; anyone else in a DM is a request, and in a space gets words only
  (ADR 0075), their words read as someone else's.
- **The service account** needs no roles in the project: it can only act as
  the Chat app. Its key lives in the sealed `channels.secrets.json` (a
  `secret` in backups), listed in Passwords, never logged or returned; the
  access tokens it's traded for go only to Google Chat's API. The bearer
  tokens Google sends are never logged either.
- **Who may talk**: the Chat app's visibility in the configuration, and then
  Conch's own rule: nobody until **That's me** or **Let in**.

## Consequences

- About twelve minutes, and only with a Workspace account.
- Tested against a pretend Google; not yet against a real Workspace.
