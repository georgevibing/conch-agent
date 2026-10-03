# 0064 — Your own address: HTTPS by Conch itself, and a link that makes it yours

- Status: accepted
- Date: 2026-10-03
- Amends: [ADR 0011](./0011-authenticated-reverse-proxy.md) (a proxy is no longer the only
  way onto the internet), [ADR 0026](./0026-always-on.md) and
  [ADR 0029](./0029-menu-bar-and-little-computer.md) (the installer, a computer that stays on)
- Goes with: [ADR 0065](./0065-passkeys-and-approving-from-your-devices.md) (how the owner signs
  in and lets new devices in)

## Context

Putting Conch on a server you rent (a VPS) and opening it at `conch.example.com` took, until
now, about ten terminal commands, three SSH sessions, four environment variables, a reverse
proxy with its own login, and an SSH tunnel just to connect a provider. Each step is reasonable
alone. Together they are the opposite of the Conch promise: a person who has never configured
nginx can't do it, and a person who has will get one of the ten steps subtly wrong.

The hard parts were never the person's to do:

- **HTTPS.** Conch couldn't answer on a domain itself, so it needed a proxy for a certificate.
  Caddy showed years ago that a server can get and renew its own certificates with nothing to
  configure (ACME, RFC 8555).
- **The first sign-in.** A new Conch only lets in "this computer" until sign-in is set up. On a
  server, nobody sits at this computer: the owner had to tunnel in to choose a password.
- **Knowing what to type.** `CONCH_ALLOWED_HOSTS`, `CONCH_PORT` and friends had to be exported
  before the installer ran, or the background service never learnt them.

## Decision

Conch can serve **its own address**: a domain or subdomain the person owns, over HTTPS, with a
certificate it gets and renews by itself. The installer asks about it in plain words, and ends
with **a link that makes Conch yours**, opened on the person's own computer.

### The installer is a conversation

At the end of `install.sh` (and `install.ps1`), on a computer with a keyboard and no screen of
its own (an SSH session, or `--server`), Conch asks:

```
  How will you reach Conch?

    1  From anywhere, at an address of my own (like conch.yourname.com)
    2  Only from my own devices, privately (Tailscale)
    3  Just from this computer for now
```

The questions are `conch setup`, written in TypeScript beside the rest of the CLI, so both
installers and a later `conch setup` share them. `--domain conch.example.com` answers the first
two questions for a script, and with no keyboard Conch never asks anything (it prints what it
would have asked and how to answer it later).

For **an address of my own** it:

1. Takes the address, as typed: `conch.yourname.com`, `https://conch.yourname.com/`, or with
   capitals. It's a hostname from then on (IDNA, no port, no path; anything else is explained).
2. Works out the server's public IPv4 and IPv6 addresses: from its own network interfaces when
   they are public, otherwise by asking Cloudflare's `cdn-cgi/trace` (and ipify as a second
   source). Only the request's own address is learnt; nothing about Conch is sent.
3. Looks the name up at public resolvers (1.1.1.1, 8.8.8.8, then the system's own), so a stale
   local cache can't hide a record that is already there. When it doesn't point here yet, it
   shows the exact record to add (`A`, the name relative to the domain — `conch` for a
   subdomain, `@` for the bare domain — and the IP) and **waits**, looking again every few
   seconds with the pearl turning, until it does. A proxy in front of the name (Cloudflare's
   orange cloud) is recognised and explained.
4. Makes sure Conch can answer on ports 80 and 443 (below), and that a firewall on this server
   lets them through. `ufw` and `firewalld` are recognised, and the one command to open them is
   offered and run with `sudo` when the person says yes. A provider's firewall Conch can't see
   is found by the next step, and named.
5. Proves the whole path from the outside before asking a certificate authority: it serves a
   random token at `http://<name>/.well-known/conch-check/<nonce>` and fetches it through the
   name. Only this Conch knows the token, so a yes means the name, the record and the port
   all lead here.
6. Gets the certificate (Let's Encrypt) and starts answering at `https://<name>`.
7. Prints the link that makes Conch yours, with a QR code.

**Only from my own devices** is the Tailscale path that already exists (ADR 0027), ending with
the same link. **Just this computer** changes nothing.

### HTTPS, by Conch itself

`apps/server/src/address/`:

- **The address** lives in `~/.conch/address.json`: the name, when it was set, and the
  computer it was set on. It's a setting the person chooses, not an environment variable, so
  `conch address`, Settings and the installer all change the same thing and the background
  service needs nothing passed to it.
- **Two listeners** beside the gateway's own loopback one:
  - `:443` (`CONCH_HTTPS_PORT`), TLS 1.2+, the certificate for that name only. Requests and
    WebSocket upgrades are handed to the gateway's own Fastify server, so every guard in
    `registerSecurity` applies unchanged: the Host must be the name, the origin must match, and
    the socket's address is the client's (it isn't loopback, so nothing about it can look like
    this computer). Responses carry HSTS.
  - `:80` (`CONCH_HTTP_PORT`) answers only ACME's `http-01` challenges and Conch's own
    reachability check, and sends everything else to `https://` with a permanent redirect. It
    serves no app, no API and no WebSocket.
- **The ACME client** is Conch's own, about three hundred lines of RFC 8555 over `fetch`, with
  `jose` for the JWS and `@peculiar/x509` for the certificate request: no crypto of its own.
  Keys are ECDSA P-256. The account key and the certificate's key are 0600 in
  `~/.conch/address/`, readable only by you. `acme-client`, the common package, was not chosen:
  it hasn't changed since 2024, and it brings `axios` and `node-forge` with it.
- **Renewal** follows the certificate authority's own advice when it gives some (ACME Renewal
  Information, RFC 9773), and otherwise starts when a third of the lifetime is left. Let's
  Encrypt is shortening lifetimes (to 45 days by 2028), so nothing assumes 90. A failed renewal
  is retried with backoff, never faster than Let's Encrypt's limits allow, and the old
  certificate keeps serving meanwhile. The new one is swapped in with `setSecureContext`,
  without a restart and without dropping a connection.
- **Teams and WeChat's public door** (ADR 0045) can use the same address: `https://<name>/conch/…`
  goes to the door's own listener, never to the gateway, exactly as Tailscale Funnel's path
  does. It opens only when the person turns the door on.

### Ports 80 and 443, as you

Conch never runs as root. Where binding below 1024 needs a privilege:

- **Linux** gives the one capability needed, `CAP_NET_BIND_SERVICE`, to Conch's _own_ copy of
  Node (`~/.conch/runtime/node`, in a folder only you can open), with
  `sudo setcap cap_net_bind_service=+ep`. Nothing else on the system gains anything, and nothing
  Node starts inherits it. When Conch runs on a system Node, `conch setup` first gets its own,
  checked against nodejs.org's checksums as the installer does. A new Node from an update loses
  the capability, and Repair everything says so with the one command.
  - **Not chosen:** `net.ipv4.ip_unprivileged_port_start=80`, which lets every account on the
    computer take the web's ports while Conch isn't running; a root-owned system service (Conch
    would no longer run as you); a port redirect in the firewall (it differs on every
    distribution and hides the client's address from local connections).
- **macOS** lets anyone listen on any port since Mojave, and **Windows** needs only the
  firewall rule, which `conch setup` offers.

### The link that makes Conch yours

A Conch that nobody has claimed (sign-in is still `none`) can make **a hello link**:
`https://<name>/#hello=<code>`.

- Made only with proof of this computer: `conch hello` (or `conch setup`, which runs it) in a
  terminal on it, or a local request with ADR 0063's proof. Never from another device.
- 32 random bytes, kept only as a SHA-256, single use, valid for an hour, at most five at once.
  Like `#pair=` (ADR 0027), the code rides in the fragment, which never reaches a server log,
  and the web app removes it from the address bar before anything else runs.
- Opening it shows **Make Conch yours**: the device's own passkey (ADR 0065) as the big button,
  a password one click away. Choosing either one sets how Conch is signed in to, signs this
  browser in as an approved device (`approvedHow: 'hello'`), turns **Approve new devices** on,
  and uses up the code, all in one write. Whoever opens the link first owns Conch, so the
  terminal says so beside the link and QR code, and the link stops working the moment it's used.
- The code is checked again when the credential is set (not only when the page opens), so a
  code that expired or was used in another tab sets nothing.
- After `conch reset` Conch is unclaimed again, so `conch hello` is also the way back in from a
  terminal.

### Approve new devices, on by default here

A Conch on the internet is a front door. The hello link turns **Approve new devices** on, so a
password that leaks lets nobody in by itself. ADR 0065 lets the owner approve from their own
devices, because on a server nobody sits at "this computer". The checkup shows a **warning**,
not an info, when an address of your own is on and approval is off.

### What replaces the proxy's login

ADR 0011 put a second login at the proxy because Conch's own sign-in was the only lock on an
internet-facing gateway. With an address of its own, Conch has more than one:

- TLS that Conch terminates itself, so nothing between the browser and Conch can see or change
  a request;
- passkeys, which can't be phished or reused (ADR 0065);
- device approval on by default: the right password on a new device still waits for the owner;
- the sign-in limiter, keyed by the real client address (there is no proxy to hide it);
- the Host, Origin and Fetch Metadata guards, unchanged.

A reverse proxy is still supported for people who already run one (ADR 0011 stands for that
case, and `docs/REVERSE_PROXY.md` says when to choose it). When ports 80 or 443 are taken by
another program, `conch setup` says which program it is and points at that page instead of
guessing.

### Whole Conch

- **Repair everything:** an `address` check. It looks at whether the certificate is valid and
  how long is left (and renews when asked), whether the name still points here, whether the
  ports are bound, and whether the capability is still there on Linux. Each finding has one
  next step: renew, the DNS record to fix, or the command to copy.
- **Backups:** `address.json` is `kept`. The certificate, its key and the ACME account are
  `derived`, because a new computer gets its own. Restored on another computer, the address
  opens nothing by itself: the name must point at the new computer, so it waits for
  `conch setup` or **Turn on here** there, like the door (ADR 0045).
- **The security checkup:** whether the address is on, its certificate is healthy, and approval
  is on.
- **⌘K:** "Your address", "Domain", "HTTPS certificate" open its section in Settings → Security.
- **Where Conch says it lives:** `HostPolicy.urls()` lists `https://<name>` first, so pairing
  links, QR codes and the CLI point there.

## Consequences

- Putting Conch on a server is one line, a few answers, and a link opened on your own computer.
  The person never edits a file, exports a variable or SSHes back in.
- Conch now holds a certificate's private key and listens on the internet itself. The key is
  0600 in a 0700 folder, never in a backup, and only the gateway reads it. The listeners do
  nothing a proxy didn't do before, and the gateway's guards see the real client address.
- Two new dependencies: `@peculiar/x509` (the certificate request; also used by passkeys,
  ADR 0065) and nothing else; `jose` was already here.
- Let's Encrypt's terms apply. The installer says that it uses Let's Encrypt and links to the
  terms before the first certificate; the ACME account carries no email unless the person gives
  one, so expiry mail is Conch's job (Repair everything), not theirs.
- A server whose provider blocks port 80 can't use `http-01`. `conch setup` says so in those
  words and offers the other two choices.

## Sources

- RFC 8555 (ACME), RFC 9773 (ACME Renewal Information), Let's Encrypt's rate limits and its
  2025 announcement of shorter certificate lifetimes.
- Caddy's automatic HTTPS (on-demand issuance, renewal at a third of the lifetime, keeping the
  old certificate on failure), which this follows in spirit.
- `capabilities(7)` and `setcap(8)`; Node's `SafeGetenv`, which keeps reading the environment
  when `CAP_NET_BIND_SERVICE` is the only capability (nodejs/node#37727).
- OWASP ASVS 5.0 V12 (secure communication: TLS 1.2+, HSTS) and V13 (configuration: secrets
  readable only by the service).
- The Clawdbot exposure (January 2026), already cited by ADR 0063: an internet-facing agent
  gateway must not trust loopback and must not start open.
