# 0011 — Authenticated reverse-proxy deployment

- Status: accepted
- Date: 2026-09-29
- Amended by: [ADR 0064](./0064-your-own-address.md) (Conch can serve an address of
  its own over HTTPS itself; this proxy is the way for people who already run one)

## Decision

Serve the built web app from the loopback gateway behind an authenticated HTTPS
reverse proxy. Keep the proxy login and Conch's independently revocable access
keys. Configure deployment with `CONCH_ALLOWED_HOSTS`, `CONCH_HOST`, `CONCH_PORT`,
`CONCH_HOME` and `CONCH_WEB_DIST`; no deployment hostname belongs in source.

The proxy preserves Host (including port), Origin and Fetch Metadata for HTTP
and WebSockets. It discards client forwarding headers and sets its own trusted
values. Conch must not trust arbitrary `X-Forwarded-Host` or disable origin checks.
Host-rewriting routers need an explicit per-app preservation option.

The outer login covers HTML, assets, APIs and upgrades. Conch exchanges a key
entered in its sign-in form for a host-only HttpOnly session cookie. No URL tokens,
proxy-injected shared credentials, or legacy `CONCH_TOKEN`. Stripping Authorization
at the outer proxy is compatible with browser key sign-in (JSON body then cookies).

## Threat model

Internet clients, hostile browser origins (including sibling subdomains), leaked
outer sessions and misconfigured forwarding must not gain Conch authority.
Regression tests cover proxy-local confusion, unknown hosts, foreign-origin
writes, key revocation, logout and HTTPS cookie attributes.

Conch still runs as its OS user, not inside a filesystem sandbox. The authenticated
owner can change trust and workspace settings. Use Ask first, no active routines,
no trusted custom integrations, a deliberate workspace and a minimal launch
environment without unrelated host credentials. Serve built files through the
gateway so its CSP covers the document; do not publish raw Vite source endpoints.

## Sources and acceptance

- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): target-origin checks and Fetch Metadata; sibling origins are untrusted.
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): TLS, Secure/HttpOnly cookies, revocation, no URL session tokens.

Tests without a provider are necessary but not sufficient: verify both login
gates, API writes, WebSockets, logout and revocation across the deployed proxy.
See [the deployment runbook](../REVERSE_PROXY.md).

## Rejected upgrade connections

Live verification exposed a connection-reuse failure after rejected upgrades.
Node detaches a socket from its HTTP parser when it emits `upgrade`. Conch's
security hook can reject before the websocket plugin marks `request.ws`, so the
plugin's normal rejection cleanup does not close that socket. An HTTP rejection
advertising keep-alive then allows a proxy to reuse a connection that can no
longer parse the next request, stalling subsequent upgrades.

An `onSend` hook now marks every HTTP response to a WebSocket upgrade
`Connection: close`; an `onResponse` hook ends the detached socket after the
response is flushed. Successful upgrades bypass these hooks via hijacking and remain
unchanged. A real TCP regression verifies response delivery and EOF for 401, 403,
and 421; the authenticated socket lifecycle test still verifies successful
upgrade, ping and immediate revocation.

Sources: [Node HTTP upgrade events](https://nodejs.org/api/http.html#event-upgrade)
and [Fastify WebSocket hooks](https://github.com/fastify/fastify-websocket#using-hooks).
