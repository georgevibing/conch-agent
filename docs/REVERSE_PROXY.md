# Behind a tunnel or reverse proxy

> [!TIP]
> Nothing in front of Conch yet? Conch can answer at an address of your own by itself, with
> its own certificate and nothing else to run: `conch setup`, or
> [On a server](../apps/docs/content/start/server.md). This page is for when a Cloudflare
> Tunnel, nginx, Caddy or another program already answers for you.

Conch stays on this computer (`http://127.0.0.1:4317`). Your tunnel or web server answers at
the name over HTTPS, and hands every request and WebSocket to Conch. Conch opens no port and
gets no certificate. It still asks everyone who opens it there to sign in.

## Set it up

On the computer running Conch:

```sh
conch setup
```

Choose **Through a tunnel or web server I already run**, and type the name you'll open, like
`conch.yourname.com`. Conch shows where to point your tunnel or web server, checks the way in
through it, and ends with the link that makes Conch yours. Open that link on your own computer
or phone, and choose Touch ID, Windows Hello or a password.

The install line can answer the first questions for you:

```sh
curl -fsSL https://conchagent.com/install.sh | sh -s -- --proxy conch.yourname.com
```

In the app, it's **Settings → Security → Your address → Set up**, then **I already run a tunnel
or web server for it**. To change the name later: `conch address set <name> --proxy`.

## Cloudflare Tunnel

Add a public hostname for the name, with Conch as its service. In a tunnel managed from the
dashboard, that's **Networks → Tunnels → your tunnel → Public hostnames**, with the service
`http://127.0.0.1:4317`. In a tunnel configured locally, add a rule to its `config.yml` above
the last one:

```yaml
ingress:
  - hostname: conch.yourname.com
    service: http://127.0.0.1:4317
  # …your other rules…
  - service: http_status:404
```

Then give the name its DNS record and restart the tunnel:

```sh
cloudflared tunnel route dns <your tunnel> conch.yourname.com
```

Cloudflare passes on the name people typed and says the request came over HTTPS, so there's
nothing else to set. A Cloudflare Access application in front of the name (an email code, say)
is a good second lock: Conch sees that the tunnel asks for its own sign-in, and says so.

## nginx

```nginx
location / {
    proxy_pass http://127.0.0.1:4317;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
}
```

`proxy_set_header Host $host;` matters: without it nginx sends `127.0.0.1:4317`, and Conch
says that the name isn't passed on.

## Caddy

```caddy
conch.yourname.com {
    reverse_proxy 127.0.0.1:4317
}
```

Caddy passes on the name, the client's address and HTTPS by itself.

## What Conch needs from it

- **HTTPS** on every path and WebSocket upgrade.
- **The browser's own `Host`, `Origin` and `Sec-Fetch-*`**, on HTTP and WebSockets.
- **Forwarding headers it sets itself:** drop inbound `Forwarded`, `X-Real-IP` and
  `X-Forwarded-*`, and set `X-Forwarded-Proto: https` and `X-Forwarded-For`. Conch reads the
  last `X-Forwarded-For` entry to limit sign-in attempts per visitor.
- **No permissive CORS**, and no turning off origin checks.

A proxy that gets this wrong still doesn't get in as this computer. With nginx's defaults
every visitor looks like the computer Conch runs on, but Conch doesn't trust looks for that
([ADR 0063](adr/0063-this-computer-is-proven.md)): a browser is this computer only once Conch
has opened it there. Visitors sign in like any other device, and wait for approval.

## When something's in the way

Conch checks the way in when it's set up, and again by itself until it works. **Settings →
Security → Your address**, `conch address` and **Repair everything** say what it found, in one
sentence:

- **Reaches your tunnel or web server, but it can't reach Conch:** point it at
  `http://127.0.0.1:4317` (or the port `conch status` names).
- **Doesn't pass on the name people typed:** keep the `Host` header.
- **Can't be found yet:** the name has no DNS record yet. New names can take a few minutes.
- **Nothing answered:** the tunnel or web server isn't running, or doesn't answer over HTTPS.

## Several names, or by hand

`conch setup` keeps one name, and checks it. For more names, or a proxy Conch can't check,
start Conch with them, comma separated:

```sh
export CONCH_ALLOWED_HOSTS=conch.example.com,conch.example.org
```

Set it before the installer runs (or before `conch background on`), and Always on keeps it.
Allowed hosts are hostnames without schemes, ports or paths. `CONCH_ALLOW_REMOTE=1` is
unnecessary behind a proxy on this computer.

For supervisors that track process groups, launch Node directly to avoid package manager
child process groups: from the repository root, use
`node --import ./apps/server/node_modules/tsx/dist/loader.mjs apps/server/src/main.ts`.

## Signing in, and scripts

People sign in with a passkey or the password they chose from the link that made Conch theirs,
and new devices wait for approval. Scripts sign in with an access key: make one in a private
terminal on this computer, and keep it in a password manager.

```sh
conch key "My script"
```

Revoke keys in **Settings → Security → Access keys**, or here:

```sh
conch keys
conch revoke <key-id>
```

Revoking in Settings closes that key's sessions and sockets at once. From the terminal, restart
Conch after an emergency revocation to disconnect sockets already open. Conch keeps only hashes
of keys.

## Development and verification

The gateway serves `apps/web/dist` (override with `CONCH_WEB_DIST`) and picks up rebuilt
assets without a restart. This deployment deliberately does not expose raw Vite endpoints; the
gateway's document CSP remains active.

Before relying on it, check the final name: the proxy's own sign-in (if it has one) on HTML,
assets, APIs and upgrades; Conch's sign-in and its cookie flags; a WebSocket ping; a refused
foreign origin; sign-out; revoking a test key; and that an unknown name gets a 421 and Conch
still listens on loopback only.

See [ADR 0011](adr/0011-authenticated-reverse-proxy.md) for the threat model, and
[ADR 0067](adr/0067-your-address-through-a-tunnel.md) for how Conch checks the way in.
