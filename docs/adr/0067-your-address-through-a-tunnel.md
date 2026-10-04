# 0067 — Your address through a tunnel or web server you already run

- Status: accepted
- Date: 2026-10-04
- Amends: [ADR 0064](./0064-your-own-address.md) (a third answer to "how will you reach
  Conch?"), [ADR 0011](./0011-authenticated-reverse-proxy.md) (a proxy is set up by
  `conch setup`, not by environment variables)

## Context

ADR 0064 made "an address of my own" one line and a few answers, with Conch answering on ports
80 and 443 and getting its own certificate. Many people who put Conch on a server already run
something that answers there: a Cloudflare Tunnel, nginx or Caddy in front of other apps. For
them the installer had no answer. Trying it end to end with a Cloudflare Tunnel:

1. **"An address of my own" can't work.** A tunnel's name resolves to Cloudflare, so Conch said
   to switch it to "DNS only" (the grey cloud), which a tunnel can't do. Ports 80 and 443 aren't
   reachable from the internet at all.
2. **The way that worked was undiscoverable.** Exporting `CONCH_ALLOWED_HOSTS` before the
   installer ran, which only reading the source revealed. The background service then answered
   at the name, but `conch hello` (a separate process, without that variable) worked out its
   addresses from its own environment, said "Conch is only reachable from this computer right
   now", and gave no link.
3. **"Just this computer" didn't notice.** It printed an SSH tunnel command for a name a proxy
   already reached.
4. **The documentation** still described the access-key sign-in that the hello link replaced.

## Decision

### A fourth answer

```
  How will you reach Conch?

    1  From anywhere, at an address of my own (like conch.yourname.com)
    2  Through a tunnel or web server I already run (Cloudflare Tunnel, nginx, Caddy)
    3  Only from my own devices, privately (Tailscale)
    4  Just from this computer for now
```

For the second, `conch setup`:

1. Takes the name people will open. Behind a proxy of their own no certificate authority sees
   it, so a name inside a home network (`conch.home.lan`) is allowed; everything else about the
   name is checked as before.
2. Shows where to point the proxy (`http://127.0.0.1:<port>`, the gateway on this computer),
   with the one line for Cloudflare Tunnel, nginx and Caddy.
3. Writes the address with `via: 'proxy'` and follows the running Conch's answer, as for an
   address of its own.
4. Ends with the link that makes Conch yours, at `https://<name>`.

`conch setup --proxy NAME` (and `install.sh --proxy NAME`, `$env:CONCH_PROXY` on Windows) answers
the first two questions, as `--domain` does. `conch address set NAME --proxy` changes it later.
When "an address of my own" finds the name behind Cloudflare, it asks whether a Cloudflare Tunnel
(or another proxy of theirs) answers there, and goes this way when it does. Settings → Security →
Your address has the same path: **I already run a tunnel or web server for it**, and **It's a
Cloudflare Tunnel** beside the Cloudflare finding.

### `via: 'proxy'` in the address

`address.json` gains `via` (`conch` when left out). Through a proxy the `AddressService`:

- **opens nothing and asks nobody:** no listener on 80 or 443, no ACME account, no certificate.
  Moving from Conch's own certificate to a proxy closes the listeners and forgets the
  certificate, its key and the renewal state;
- **allows the name at once** (`HostPolicy.setOwnAddress`), so pairing links, QR codes and the CLI
  point there, and the proxy works the moment it's pointed here;
- **checks the way in through it:** the gateway answers `/.well-known/conch-check/<nonce>` on its
  own port with a token only it knows, for as long as the check runs, and Conch fetches it at
  `https://<name>`. A match means the record, the proxy and where it points all lead here;
- **tells a lock from a fault:** a redirect, a 401 or a 403 is the proxy's own sign-in in front
  (Cloudflare Access, say). Conch can't look through it and shouldn't, so the address is
  `ready` with `guarded: true`. A 502–504 or 520–530 is a proxy that can't reach Conch; this
  Conch answering under another name is a proxy that doesn't pass `Host` on; another answer is
  something else at the name; a failed lookup is a name that doesn't exist yet. Each is
  said in one sentence that names where to point the proxy, and Conch looks again by itself
  (30 seconds, doubling to 15 minutes), noting in "Fixed on its own" when it reaches Conch again.

Renewing, Repair everything and **Try again** look through the proxy again; nothing else is Conch's
to mend there.

### Where the running Conch answers, for the CLI

`gateway.json`, which the running gateway writes so the CLI finds it, now also carries the names
it answers to (`allowedHosts`, from `CONCH_ALLOWED_HOSTS`). The CLI adds them to its own, as it
already took the port from there, so `conch hello` and `conch pair` point where the service
really answers even when the terminal doesn't have the variable. "Just this computer" says
when Conch already answers to such a name, and hands over the link there instead of an SSH tunnel.

### What stays

`CONCH_ALLOWED_HOSTS` still works, and is how a proxy for several names, or one Conch can't check,
is set up. The 421 for an unknown name now points at `conch setup` instead of the variable. Access
keys still sign in scripts. ADR 0011's requirements of the proxy stand: HTTPS, the browser's
`Host`, `Origin` and `Sec-Fetch-*` passed on, forwarding headers it sets itself, no permissive CORS.

## Threat model

- **The check route** is outside `/api`, so it answers without a sign-in, like the port 80
  listener's. It only answers to an allowed `Host`; it returns a random token for a random nonce
  Conch made moments ago and forgets when the check ends; everything else is a 404. It says
  nothing about Conch and changes nothing.
- **Allowing a name** doesn't open a port: the gateway still listens on loopback only. What reaches
  it through the proxy comes from loopback, which is not trust (ADR 0063): visitors sign in, new
  devices wait for approval (the hello link turns it on), and the checkup still warns when an
  address is on and approval is off.
- **Who may set it:** as for an address of Conch's own. `address.json` is a protected path, and
  `conch setup` and `conch address` are kept from the assistant's shell (`lib/protect.ts`); the
  Settings route needs the owner on a device that's let in, who just confirmed it's them.
- **`gateway.json` is now protected too.** `conch hello` puts its one-time code in a link at the
  names it lists, and a hello code is ownership of an unclaimed Conch. An assistant able to write
  a name of its choosing there could have the next link sent to a page that reads the fragment.
  The file holds nothing the assistant needs.
- **A proxy that rewrites `Host`** (nginx's default sends `127.0.0.1:4317`, which is always
  allowed) makes every visitor look like loopback. That still isn't this computer (ADR 0063),
  but the browser's `Origin` then never matches and sign-in breaks. The check route gives its
  token only under the name being checked, and answers `wrong-host` otherwise, so the setup says
  to pass the name on (the setup's nginx line already does).
- **A downgrade** to a version before this drops `via` and tries for a certificate on the name.
  That fails safely (no port 80, or Let's Encrypt can't reach it), and the name stays allowed, so
  the proxy keeps reaching Conch.

## Consequences

- With a Cloudflare Tunnel (or nginx, or Caddy) already in place, putting Conch behind it is the
  install line, one choice, the name, and the link. No environment variable, no restart.
- Conch doesn't know whether the proxy keeps its own sign-in; it says so in the checkup, and
  relies on its own sign-in and device approval either way.
- One more file is out of the assistant's reach (`gateway.json`).

## Sources

- Cloudflare Tunnel's ingress rules and origin parameters (`service`, `httpHostHeader`, whose
  default keeps the visitor's `Host`), and Cloudflare Access's redirect to its login.
- nginx `proxy_set_header Host $host` (by default nginx sends the upstream's address), Caddy's
  `reverse_proxy`, which keeps `Host` and sets `X-Forwarded-Proto` by itself.
- OWASP ASVS 5.0 V13 (configuration) and the Fetch Metadata resource-isolation guidance, as in
  ADR 0011; ADR 0063 for why loopback through a proxy is not this computer.
