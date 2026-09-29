# 0008 — Access: sign-in, sessions and gateway hardening

- Status: accepted
- Date: 2026-09-29

## Context

The gateway runs commands and edits files **as the user**. Anyone who can talk to
it owns the machine, so it has to be treated like an SSH server. The first version
had one shared `CONCH_TOKEN`, passed once in `?token=` and kept as a raw
year-long cookie. Only a single hostname check stood in the way of cross-site
requests. People want Conch on their phone, and they won't read a manual.

A security audit (2026-09-29) also found:

- The agent could draft a **full-trust** routine and switch it on itself, which
  lets a prompt injection persist.
- Two DELETE routes had **path traversal**.
- The Origin check compared hostnames but not ports, so any page on
  `localhost:<other port>` could drive the agent.
- `CONCH_TOKEN` was inherited by the agent's shell.
- The token and search queries appeared in logs.
- "Always allow" quietly wrote permanent rules into `.claude/settings.local.json`.
- Remote images in replies could exfiltrate data.

## Decision

### One choice, three answers

Settings → Security asks _How do you sign in?_

| Method     | For                            | Stored as                                                   |
| ---------- | ------------------------------ | ----------------------------------------------------------- |
| Password   | You, on your own devices       | scrypt `N=2^17, r=8, p=1` (OWASP), username + hash          |
| Access key | Scripts, a shared tablet, APIs | `conch_` + 256 random bits, SHA-256 hash, named & revocable |
| No sign-in | This computer only (default)   | —                                                           |

The methods are exclusive, so the mental model stays simple. Switching methods, or
changing the password, signs every other device out (ASVS 5.0 V7.4.3). The
password rules follow **NIST SP 800-63B-4**:

- at least 15 characters, and no composition rules;
- every character is allowed, and paste, password managers and a show/hide toggle
  all work;
- the whole password is checked against a blocklist, along with repetition and
  sequence checks and a check against the username;
- there is no forced rotation.

A **Suggest a strong one** button makes an Apple-style `xxxxxx-xxxxxx-xxxxxx`
(90 bits, easy to type on a phone). A strength meter explains any rejection in
words.

### "No sign-in" is still safe

With sign-in off, only **genuinely local** requests are served. A request is local
when all three hold:

- the socket is loopback;
- the `Host` is a loopback name;
- there is no `Forwarded`/`X-Forwarded-*` header.

The loopback check alone would trust `tailscale serve`, `vite --host` or any
reverse proxy. Every other request gets `401 setup-required`, and the page says
"Almost there — choose a password on the computer running Conch". So
`CONCH_ALLOW_REMOTE=1` no longer needs a token at start-up (`pnpm start:network`).
It is still an explicit opt-in.

### Sessions

- Every sign-in creates a new session (so no session fixation). The cookie holds a
  random 256-bit value, and only its SHA-256 is stored in `~/.conch/access.json`
  (mode 0600).
- The cookie is `HttpOnly; SameSite=Strict; Path=/`. Over HTTPS it's
  `__Host-conch_session; Secure`.
- A session expires 30 days after sign-in (NIST AAL1) or after 7 idle days.
- Sessions are listed per device ("Safari on iPhone"), and each can be revoked.
  Revoking a session closes its WebSocket immediately (close code 4401), and
  sockets re-check their session on every message.
- **Sudo mode:** creating keys, changing the password, pairing and turning sign-in
  off all require a password or key entered in the last 10 minutes.
- **Throttling:** each address (an IPv6 /64 counts as one) gets 5 free failures,
  then an exponential back-off capped at 15 minutes. After 100 consecutive failures
  in total, remote sign-in is locked, but local sign-in still works, so an attacker
  can't lock the owner out. Unknown usernames cost the same scrypt time as wrong
  passwords. Error messages never say which field was wrong. No more than two
  hashes run at once (128 MiB each).

### Adding a phone

**Add a device** shows a QR code of `https://<host>/#pair=<code>`:

- The code is single-use, 256-bit, expires after 10 minutes and is stored hashed.
- It sits in the URL _fragment_, so it never reaches server logs or `Referer`.
- The web app removes it from the address bar before doing anything else.

`pnpm conch pair` prints the same code in the terminal. The gateway finds
Tailscale by itself (`tailscale status --json`) and allows the machine's own
`*.ts.net` name. The UI recommends Tailscale as the encrypted path: warnings sit on
any plain-HTTP network address, the sign-in page flags an unencrypted connection,
and the checkup marks it as danger.

### Recovery

Having a terminal on the host is proof enough. `pnpm conch reset` turns sign-in
off, and `pnpm conch password` sets a new password (input is hidden, or it can
generate one). The CLI writes the same `access.json`. The gateway re-reads that
file when it changes, so this works while Conch is running.

### Browser and API hardening

1. `Host` allowlist (DNS rebinding).
2. **Fetch Metadata**: `Sec-Fetch-Site` values other than `same-origin`/`none` are
   refused, except plain navigations to the app.
3. `Origin` must equal the request's own `Host` **including the port**, for
   writes, upgrades and every API request. `Origin: null` is refused.
4. The `text/plain` body parser is removed, so every body must be
   `application/json`, which a cross-site page can't send without a preflight.
5. Auth decisions use the **matched route**, not the raw URL (`/%61pi/state`
   can't slip past).
6. Headers:
   - CSP: `default-src 'self'`, `script-src 'self'`, and `img-src 'self' data:
blob:` (no remote images, which blocks markdown-image exfiltration);
   - `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`;
   - COOP and CORP `same-origin`;
   - a Permissions-Policy denying hardware APIs;
   - HSTS over HTTPS;
   - `no-store` on the API.

   `style-src` keeps `'unsafe-inline'` because toasts and animations inject
   styles; styles can't run script.

7. The logger drops query strings. `?token=` is no longer accepted (the web app
   accepts one from an old bookmark, removes it from the URL at once, and uses it
   to sign in as a key). The WebSocket `maxPayload` is 1 MB, with at most 200
   subscriptions per socket.
8. Every `:id` and `:name` in a URL is validated before its handler runs, and
   every store builds paths with `safeJoin`, which throws on `..`, slashes or NUL.
9. `CONCH_*` variables are stripped from the agent's environment. `~/.conch` is
   tightened to 0700/0600 at start-up, and `search.db` is created with mode 0600.
10. **Agent cannot escalate:**
    - drafts from `create_routine` always start at "ask";
    - `update_routine` can't activate a routine, and if it rewrites the prompt of
      an active routine, that routine is paused with its trust reset;
    - unattended runs don't get the routine tools at all;
    - permission prompts in unattended runs expire (deny) after an hour;
    - Claude Code's suggested permission rules are no longer persisted;
    - memories go into the prompt marked as facts, never instructions.

### Warnings everywhere

A **security checkup** (Settings → Security, the start-up banner, and
`pnpm conch status`) states each risk in plain words and how to fix it:

- running as root;
- plain HTTP on a network;
- a token in the environment;
- a "Full trust" default;
- keys unused for 90 days;
- files other users can read.

### Dependency

`uqr@0.1.3` (MIT, zero dependencies, ~80 kB unpacked) renders QR codes in Nacre
(as React-built SVG, with no `innerHTML`) and in the terminal. Writing a QR encoder
ourselves would be more code to get wrong than this adds.

## Consequences

- Breaking: `?token=` links no longer work, and `CONCH_TOKEN` only works as an
  access key via the sign-in form or `Authorization: Bearer`. The checkup nudges
  people to replace it.
- One user per Conch; there are no accounts or roles. Multi-user support would be a
  new ADR.
- Remaining risks, documented in ARCHITECTURE.md:
  - with sign-in off, other local OS users can reach loopback;
  - the agent can read `ANTHROPIC_API_KEY`, which it needs to run;
  - Claude Code still loads the workspace's `.claude/` settings (the checkup warns when they add hooks, auto-allowed tools or MCP servers);
  - breached-password checks are local only, because we don't call HIBP (no
    telemetry).
