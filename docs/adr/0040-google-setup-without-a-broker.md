# ADR 0040 — Google setup without a hosted connection service

## Decision

Conch does not operate an OAuth broker. Users keep their own Google project and
OAuth client. Guide the unavoidable Google Console steps in the app, accept the
downloaded credential JSON, and use the existing Google Auth Library. No new
runtime dependency, shared publisher secret, central service, or Cloud CLI.

Recommend a **Desktop app** client for both local and remote installations. On an
HTTP loopback Conch address, return to Conch's existing callback automatically.
Elsewhere, use a loopback redirect and ask the person to paste the complete return
address into Conch. This mirrors gogcli's manual/remote approach: it is an ordinary
PKCE authorization-code flow, not Google's retired out-of-band grant. The browser
may display a loopback connection error; explain that before opening Google. Do
not fetch the pasted address or require a public callback or SSH port forwarding.
Keep existing Web clients working, including automatic HTTPS callbacks.

## Boundaries

- Imported JSON is size-bounded and parsed on both sides. Accept only a single
  Desktop/Web OAuth client; reject service-account keys and ambiguous files.
  Ignore all supplied auth/token endpoint URLs. Google endpoints remain fixed.
- Only the existing sealed Google store keeps credentials. No JSON, secret,
  verifier, authorization code, or return address is stored in browser storage,
  logs, chat, or model context. Browser recovery stores only the expiring flow ID.
- Manual completion is a verified, same-origin API POST with a browser-bound
  HttpOnly cookie, single-use state, a pinned return address, and PKCE. A pasted
  code alone is insufficient. Automatic and manual flows cannot consume one
  another. Identity, audience, account continuity and granted scopes retain ADR
  0037's checks. Cancellation prevents an in-flight exchange from saving access.
- Desktop reconsent explicitly requests existing plus new capabilities because
  Google does not support incremental authorization for installed apps. No
  capability or Google account is silently switched.
- Consent and API diagnostics contain only curated messages, never upstream
  text. An API-disabled result retains tokens and offers a check after enabling
  the named API; it does not unnecessarily repeat consent.

## Experience and acceptance

The setup checklist links to the relevant Google Console pages and only the APIs
needed by the current job. It explains test users, the seven-day testing-token
limit, and the distinction between personal use and public distribution. A
credential file is checked before saving; existing Web clients get an exact
callback check. Users can skip the guide when they already have a file.

Verify imports, callback/nonce/origin binding, replay, cancellation, account and
scope continuity, API diagnostics, popup blocking, and interrupted UI flows with
bounded unit/component tests. Real Google registration/consent remains a live
acceptance step; fake Google endpoints cannot prove it. No comparative usability
benchmark or live verification is implied.

## Sources (checked 2026-10-02)

- [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
- [gogcli remote setup](https://github.com/openclaw/gogcli/blob/main/docs/quickstart.md)
- [gogcli client and PKCE handling](https://github.com/openclaw/gogcli/blob/main/docs/auth-clients.md)

This extends ADR 0037. It replaces its Web-client-only setup requirement, not its
credential, tool-approval, or durable-effect contracts.
