# ADR 0037 — Google accounts belong to Conch

## Decision

Google Gmail, Calendar and Drive connect directly to Conch, independently of model
providers or Zapier. Google Auth Library performs OAuth code exchange, PKCE and
signed ID-token verification. This is a confidential Web application; each
installation must register its own OAuth client, enable APIs, configure Google’s
consent screen and register the exact reachable callback. We do not ship a public
Google OAuth client or claim that app verification has been completed.

Request capabilities only for the selected job. Identity uses openid/email/profile;
mail reading uses gmail.readonly; drafts additionally need gmail.compose; calendar
uses calendar.events.readonly; Drive uses drive.metadata.readonly. Drive currently exposes
search and metadata, not document bodies, and the UI says so. Google has no general
Gmail draft-only scope: gmail.compose also grants send. Conch discloses that and
restricts its only write transport to POST /gmail/v1/users/me/drafts. There is no
send, arbitrary URL, header, attachment, calendar write or Drive write tool.

## Threat model and boundaries

An injected email, another website, a model, a forged callback and another Google
account are untrusted. Changing operator setup, starting consent and disconnecting
require a human’s recently verified gateway session and existing Origin/Host
checks. Callback is a cross-site navigation: single-use 256-bit state, ten-minute
in-memory expiry, PKCE S256 and a browser-bound HttpOnly SameSite=Lax cookie replace
session dependence. Origin and exact registered redirect path are pinned, remote
origins require HTTPS. No callback redirects to user-supplied URLs. Signed ID token
and token-info audience/subject/scopes are checked. Account switching during
reconnect is rejected; adding another account is explicit. Concurrent reconnects
and refreshes cannot overwrite a newer grant or resurrect a removed account.

All OAuth state is in google.secrets.json under the established device-key sealer,
protected paths, secret-only backup manifest and Passwords system-key inventory.
Only account metadata leaves the store. OAuth failures never include upstream
exceptions. API requests use fixed Google origins, no redirects, timeouts, bounded
results; refresh is single-flight. A network failure preserves consent. Revoked
consent leads to reconnect. Disconnect revokes remotely by POST body first; an
outage preserves the account and explains the next step.

Google host tools follow engine guards, taint on outside reads, skill apps
capabilities and an explicit approval on every draft. Approval binds account,
normalized arguments and consent generation, checked again immediately before
write. A token refresh does not change consent identity; reconsent does.

## Durable draft receipts

The task ledger owns operation IDs and writes its running state before an API
write. The draft receives a deterministic RFC Message-ID derived from that ID.
Reconciliation searches drafts by Message-ID and reads the raw draft back. A
receipt requires one match with exactly the requested To, subject and decoded
body. Reply drafts additionally bind the provider’s original source message/thread,
verified From/Reply-To (or To for sent followups), and RFC In-Reply-To/References.
PostalMime decodes incoming MIME and html-to-text converts HTML without loading
external resources; models receive readable bounded text and account-specific links. Missing results, pagination, multiple matches, edited drafts and network
errors are unknown — never proof that Gmail did not accept the write. Gmail
search is eventually consistent, so ambiguous writes are never automatically
repeated. Successful reads return evidence from actual API responses. A read is
safe to replay; a draft requires its recorded effect identity.

## Verification boundary

Fake Google endpoints/client seams test callback replay, origin/browser binding,
wrong account, wrong audience, denied scopes, refresh races, revocation, ambiguous
writes and readback matching. No real account, secret, email send, deployment or
browser verification is part of these tests. Operator app registration and a
real-account consent/API smoke test remain external acceptance steps.

## Sources (reviewed 2026-10-02)

- [Google Web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google Auth Library](https://github.com/googleapis/google-auth-library-nodejs)
- [Gmail draft create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create)
- [Gmail draft readback](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/get)
- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [OWASP OAuth2 guidance](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)

- [PostalMime parser](https://github.com/postalsys/postal-mime)
- [Gmail threading requirements](https://developers.google.com/workspace/gmail/api/guides/threads)
