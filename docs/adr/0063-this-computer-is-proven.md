# 0063 — "This computer" is proven, not guessed from the address

- Status: accepted
- Date: 2026-10-03
- Amends: [ADR 0008](./0008-access-and-hardening.md) ("No sign-in" is still safe),
  [ADR 0024](./0024-approve-new-devices.md), [ADR 0029](./0029-menu-bar-and-little-computer.md)

## Context

Conch trusts the computer it runs on more than anywhere else. With sign-in off, a request from
this computer is let in with nothing else. With sign-in on, this computer still decides the
things nobody else may: it approves new devices and turns approval off, it skips the
"confirm it's you" step for channels, its sign-ins approve themselves, the sign-in limiter's
global lock passes it by, and it may open a terminal without `allowRemote`.

ADR 0008 decided what counts as "this computer" from the request alone. A request was local
when the socket was loopback, the `Host` was a loopback name, and no `Forwarded`/`X-Forwarded-*`
header was present. That turns away `tailscale serve`, Caddy and Cloudflare Tunnel, which keep
the browser's `Host` or add forwarding headers. It does not turn away a reverse proxy that does
neither, and nginx's defaults do neither: `proxy_pass http://127.0.0.1:4317;` sends
`Host: 127.0.0.1:4317` and no `X-Forwarded-For`. Behind that one line, every visitor from the
internet is "this computer". With sign-in off they get the whole API, a terminal included. With
sign-in on, someone who learns the password gets past device approval and can approve
themselves.

This is not hypothetical. In January 2026 more than a thousand Clawdbot (now OpenClaw) gateways
were found open on the internet for exactly this reason: localhost was trusted without sign-in,
and same-machine reverse proxies made every visitor localhost. OpenClaw's answer was to stop
trusting loopback: its setup now makes a gateway token even for a local-only gateway. Hermes'
dashboard still trusts loopback and engages its login only when a public address is declared.

Two more gaps share the cause:

- another account on the same computer reaches `127.0.0.1:4317` too, and was "this computer"
  (ADR 0008 listed it as a known limit);
- Conch can't tell any of these apart from the real thing, because nothing in a request proves
  where it came from. The address is a guess.

## Decision

"This computer" means **your account on this computer**, and it is proven, never guessed:

> A request is from this computer when it looks local (as before: loopback socket, loopback
> `Host`, no forwarding headers) **and** it carries proof that only your account can have.

The proof starts as a secret in a file only your account can read. Everything that opens Conch
for you reads it, and turns it into a cookie for your browser.

### The key

- `~/.conch/here/key`: 32 random bytes (base64url), mode 0600 in a 0700 folder, made the first
  time Conch starts. Conch keeps it in memory and never logs it. On Windows the file sits in
  your profile, which only you (and administrators) can read.
- `pnpm conch reset` makes a new one, so every browser on this computer has to be opened from
  Conch once more.
- It is per computer: backups never carry it (`derived`), and a restore makes a fresh one.

### The proof a request can carry

1. **The cookie** `conch_here_<port>`: `v1.<issued>.<nonce>.<mac>`, where `mac` is
   HMAC-SHA-256 of the rest under the key. Conch checks it in constant time and refuses one older
   than 400 days, the most a browser keeps a cookie. It is `HttpOnly`, `SameSite=Strict`,
   `Path=/`, and host-only. It carries the port in its name, because cookies aren't separated by
   port (RFC 6265bis): two Conches on one computer, or a dev gateway beside the real one, would
   otherwise overwrite each other's cookie.

The key itself is never a credential: no header, cookie or bearer carrying it is accepted, and it
never leaves its file. Anything that is sent can be overheard and sent again (a script talking to
whatever holds Conch's port while Conch is stopped, say). A cookie that leaks can be taken back
with `pnpm conch reset`. A key that leaks could mint cookies for good. Scripts use an access key
(ADR 0008).

The cookie counts only on a request that also looks local. A cookie that leaks still doesn't
work from another computer through Tailscale or a proxy that says so.

### Getting a browser its cookie: a one-time code, through a file

The code is handed over through a small HTML file, never the browser's command line. A launcher
that runs `open http://localhost:4317/#here=…` puts the code into the browser process's argument
list, which any account on the computer can read (`/proc/<pid>/cmdline`, `ps`) and race to
redeem. A file only you can read leaves nothing to race. Jupyter's redirect file is the same
idea.

1. A launcher asks through a folder only your account can write, `~/.conch/here/asks/` (0700): it
   writes `<id>.ask` (a random id) holding the page it wants (`/?open=devices`, say).
2. Conch watches that folder (and looks every second, where the system misses a change). For each
   ask it makes a one-time code (32 random bytes, kept only as its SHA-256, gone in two minutes or
   at first use, at most 32 waiting). It writes a small HTML file, 0600, that sends the browser to
   `http://localhost:<port>/<page>#here=<code>`. Then it writes `<id>.link` (that address) and,
   last, `<id>.open` (the HTML file's path) beside the ask.
3. The launcher waits for `<id>.open` and opens the file it names with the computer's own opener.
   The browser opens it from disk and goes on to Conch. A program that opens its own window (the
   desktop app) reads `<id>.link` instead.
4. The web app takes `#here=` out of the address bar before anything else runs, the way it takes
   `#pair=` (ADR 0027), and redeems it at `POST /api/here`. Conch sets the cookie and deletes the
   file. Fragments never reach a server's logs.

The redemption needs a request that looks local. The code can't be used from another computer
even if someone saw it.

**Why a folder, not a request.** A launcher that sends the key, or the menu bar helper's token,
over loopback sends it to whatever is listening on Conch's port. While Conch is stopped, another
account can listen there and answer like Conch. It would collect the key, and could then name any
file for the launcher to open (a `.command` file runs when a Mac opens it). Only your account can
write in `here/asks`, so whatever Conch finds there was asked by you. The launcher only opens a
path that the real Conch wrote into your own folder. So the menu bar helper's token stays what
ADR 0029 made it, enough to read counts and quit and no more. `POST /api/here/link` gives a
browser that is already this computer another link, for another browser here.

**Where the file goes.** Usually `~/.conch/here/open/`. Ubuntu's Firefox is a snap, and a snap
can't read hidden folders in your home, so Conch asks which browser is the default
(`xdg-settings`). For a snap it uses that snap's own `~/snap/<name>/common/`; for a Flatpak it
uses `~/.var/app/<id>/cache/`. Both are places the browser may read. Files are deleted when used
or after two minutes, and every start clears what a crash left.

**Who opens Conch this way.** Every launcher, so most people never see any of this:

- the app shortcut (macOS, Linux and Windows) and its "start Conch first" path;
- the menu bar, tray or panel helper, for each of its pages;
- `pnpm start`, and "Conch is already running — opening it";
- the installers' last step (`install.sh`, `install.ps1`);
- the desktop app: its window loads the address with the code;
- `pnpm conch open` for anything else, and `pnpm conch open --link`, which prints a one-time link
  for a browser Conch doesn't open itself (one on the other end of an SSH tunnel). Pasting into an
  address bar isn't seen by anyone else.

### What a browser without proof sees

- **Sign-in off, a local-looking request:** `401 here-required`. The page says "Open Conch from
  your apps", with `pnpm conch open` beneath. It can't offer a "let me in" button, because that
  button would be the hole again. A visitor through a proxy that hides itself sees the same page
  and learns nothing.
- **Sign-in off, any other request:** unchanged, `401 setup-required`.
- **Sign-in on:** the normal sign-in page. A browser that signs in with the password but has no
  proof is a device like any other: approval applies to it, and it can't approve devices. The
  page says once that opening Conch from your apps makes this browser "this computer".

### What "this computer" still means elsewhere

- **Cookie flags and "secure"** describe the connection, not who's asking, so they still follow
  how the request looks (`Gatekeeper.looksLocal`). Only trust decisions need the proof
  (`Gatekeeper.isLocal`).
- **The tray's own routes** need its token, as before. Its token is proof of the same kind.
- **CLI commands** that change who may sign in still edit `access.json` directly, so they need
  your account, not a request.

### Healing

- A missing key or `open/` folder is made again on start. A key file with the wrong mode is
  reset to 0600. A key file that isn't a key is replaced, which forgets this computer's browsers;
  Conch notes that under "Fixed on its own". Repair everything checks it (`here` check).
- A launcher that can't get a code (an older Conch still running during an update, say) opens the
  plain address. The page then says what to do.

## Consequences

- The nginx default, any other same-machine proxy that hides itself, and other accounts on the
  same computer no longer count as this computer. With sign-in off they're turned away. With
  sign-in on they're one more device: approval and sudo mode apply to them.
- The known limit "with sign-in off, other OS users on the same machine can reach loopback"
  (ADR 0008, ARCHITECTURE.md) is gone.
- The one new step: typing `localhost:4317` into a browser that has never been opened from Conch
  (a new browser, a private window, cleared site data). It shows "Open Conch from your apps".
  Once per browser, the cookie then lasts 400 days.
- A script on this computer that used Conch's API with sign-in off needs an access key now.
  The e2e journeys start each browser with the cookie a launcher would have given it (minted with
  the run's key), and the server tests' `onThisComputer(app)` sends the cookie too.
  `this-computer.spec.ts` starts without it and asks through the folder, as a launcher does.
- **What's left:** a cookie for `localhost` is sent to every port on `localhost`. If you visit a
  web server that another account runs on this computer, it could read your here-cookie and use
  it. Conch's session cookie has always had the same exposure. The cookie is `HttpOnly` and
  `SameSite=Strict`, so another site can't make your browser send it, and `pnpm conch reset`
  takes every one back.

## Sources

- OWASP ASVS 5.0, V3 (session management: random, HttpOnly, SameSite tokens) and V8 (trusted
  proxies must be configured, never inferred); OWASP Session Management Cheat Sheet (cookie
  attributes).
- RFC 6265bis §8.5: cookies are not isolated by port.
- Fetch Metadata / resource isolation: the existing `Sec-Fetch-Site` and `Origin` checks still
  run first and refuse cross-site requests, so a page can't make your browser use its cookie.
- Jupyter Server's token and redirect file (`jpserver-<pid>-open.html`), and its snap-confinement
  issue, which is why the file's place depends on the browser.
- The Clawdbot exposure (Jamieson O'Reilly, 23 January 2026; 1,100+ instances on Shodan and
  Censys), and OpenClaw's fix (gateway token even on loopback; trusted-proxy mode refuses
  loopback sources by default).
- nginx `proxy_set_header` defaults (`Host $proxy_host`, no `X-Forwarded-For`).
