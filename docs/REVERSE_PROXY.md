# Authenticated HTTPS reverse proxy

Keep Conch on loopback and authenticate independently at the proxy and in Conch.

## Configuration

Use your shell or process manager to load these environment variables. Copying
`.env.example` alone does not load them.

```sh
export CONCH_HOME="$HOME/.conch"
export CONCH_HOST=127.0.0.1
export CONCH_PORT=4317
export CONCH_ALLOWED_HOSTS=conch.example.com
export CONCH_OPEN=0
```

Allowed hosts are comma-separated hostnames without schemes, ports or paths.
`CONCH_ALLOW_REMOTE=1` is unnecessary behind a local reverse proxy.

1. Before publication, run `pnpm conch key "My browser"` in a private terminal
   with this same `CONCH_HOME`. Save the one-time key in a password manager.
   Do not run it through captured logs, put the key in a URL, or set `CONCH_TOKEN`.
2. Run `pnpm --filter @conch/web build`.
3. Run `pnpm --filter @conch/server start` with a minimal environment that
   holds no unrelated credentials (password managers, cloud or router keys).
4. Keep the default mode on **Ask first**, with no active routines or trusted
   custom integrations.
5. Configure the proxy:
   - HTTPS and outer authentication on every path and WebSocket upgrade.
   - Preserve browser `Host`, `Origin` and `Sec-Fetch-*` on HTTP and WebSockets.
   - Strip inbound `Forwarded`, `X-Real-IP` and `X-Forwarded-*`; set trusted
     `X-Forwarded-Proto: https` and client attribution yourself.
   - Strip the outer session cookie upstream, but retain app-specific cookies.
   - No permissive CORS or disabled origin checks.

For supervisors that track process groups, launch Node directly to avoid package
manager child process groups: from the repository root, use
`node --import ./apps/server/node_modules/tsx/dist/loader.mjs apps/server/src/main.ts`.

Use your proxy's own setting for preserving `Host` (for example
`proxy_set_header Host $host;` in nginx; Caddy keeps it by default), and expose
Conch only after you've checked both sign-ins: the proxy's and Conch's own.

## Login and revocation

Open the HTTPS app URL, pass the outer login, then paste the saved `conch_…` key
into Conch's **Access key** field. A complete pasted key signs in automatically.
The browser gets a Secure, HttpOnly, host-only `__Host-conch_session` cookie.

Revoke using **Settings → Security → Access keys**, or a private host terminal:

```sh
pnpm conch keys
pnpm conch revoke <key-id>
```

Use the same `CONCH_HOME` as the service. UI revocation immediately closes that
key's sessions and sockets. CLI changes are re-read on access; restart Conch after
emergency CLI revocation to disconnect already-open sockets. Conch stores only
key hashes; retrieve the plaintext from your password manager or make a new key.
Revoking the last key leaves proxied clients locked out until host-side setup.

## Development and verification

The gateway serves `apps/web/dist` (override with `CONCH_WEB_DIST`) and picks up
rebuilt assets without a restart. After UI edits, rebuild and refresh. Restart
the supervisor after gateway source changes. This deployment deliberately does
not expose raw Vite endpoints; the gateway's document CSP remains active.

Verify the final hostname: outer login on HTML/assets/APIs, unauthenticated WS
denial, inner API denial with only an outer cookie, key sign-in and cookie flags,
API writes, WebSocket ping, foreign-origin denial, logout, and revocation of a
disposable test key. Also check unknown/unpublished hosts and loopback binding.

See [ADR 0011](adr/0011-authenticated-reverse-proxy.md) for the threat model.
