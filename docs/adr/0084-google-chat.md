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
  signature with Google's keys (cached six hours, an unknown key id refreshes
  them at most every five minutes), RS256 only, the issuer, the audience
  (this channel's own address), the expiry, and the email claim
  (`chat@system.gserviceaccount.com`, verified). A delivery seen before is
  one event; one more than an hour old isn't read.
- **Answers** are written in Chat's own marks (`*bold*`, `_italic_`,
  `<url|label>`), at most 3900 characters a message; approvals a card whose
  buttons say what was decided once pressed.
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
  signed for this address. Forged deliveries (another key, another audience,
  another sender, another issuer, an expired token, none) are tested to be
  401s that reach no conversation.
- **The service account** needs no roles in the project: it can only act as
  the Chat app. Its key lives in the sealed `channels.secrets.json`, listed in
  Passwords, never logged; the access tokens it's traded for go only to
  Google Chat's API.
- **Who may talk**: the Chat app's visibility in the configuration, and then
  Conch's own rule: nobody until **That's me** or **Let in**.

## Consequences

- About twelve minutes, and only with a Workspace account.
- Tested against a pretend Google; not yet against a real Workspace.
