# 0142: Recovering a stuck app sign-in

Status: accepted

## Problem

A failed OAuth renewal was marked retryable without any HTTP evidence. Apps only
exposed **Try again**, so a person could not start a fresh sign-in when retries
kept failing. Even explicit sign-in retained cached discovery indefinitely.
An AbortError during refresh was treated as an expired sign-in and could lead
to discarding usable credentials. A refused request to start signing in was
shown as a toast only for apps found in a provider.

## Decision

Preserve credentials on renewal network failures (including aborts and timeouts),
HTTP 5xx and HTTP 429. Keep automatic retry and add **Sign in again** beside
**Try again** on the HTTP OAuth app's page. Use the existing authenticated connect
route and popup/tab callback flow. Show failures to start sign-in consistently.
An explicit sign-in drops cached discovery along with old tokens, so it discovers
the current endpoints; the SDK retains issuer-bound client registration checks.

Renewal failure details contain only the request's GET/POST method, URL origin,
and HTTP status or a fixed statement that it did not complete. Do not copy paths,
queries, fragments, response bodies, headers, or raw exceptions into diagnostics.
A failed renewal does not prove a service-wide outage or a revoked sign-in.

## Security and verification

Remote endpoints and their failures are untrusted. A server could put credentials
in its token endpoint URL, response body, or thrown error. The diagnostic allowlist
keeps those out of persisted health, browser events and assistant context. No new
route, permission, stored setting or automatic authority is added, so the existing
security checkup applies. Endpoint guards, PKCE, single-use state, callback expiry
and SDK issuer binding remain on the same paths.

Regression tests exercise stale discovery recovery through a full consent/code
exchange, timeout credential preservation, HTTP 429 with hostile diagnostic data,
HTTP 503 recovery without user action, and the UI's reconnect action and error.

Sources read on 21 October 2026:

- [MCP security best practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices): untrusted discovery and credential boundaries.
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): exclude credentials and untrusted sensitive error data.
- [Cloudflare MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/): current Streamable HTTP endpoint and OAuth flow.
