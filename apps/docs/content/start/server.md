---
title: On a server
description: Put Conch on a server you rent and open it at your own address. One line, a few answers, and a link that makes it yours.
order: 1.7
---

On a server that stays on, routines run on time and your assistant is there from any device. Conch answers at your own address, like `conch.yourname.com`, and handles the secure connection itself. No proxy, no files to edit.

## What you need

- A Linux server with SSH. 2 GB of memory is comfortable.
- A domain you own, or a subdomain of it.

## Install

On your server, run:

<!-- conch:install-server -->

Conch installs, starts and asks how you'll reach it.

## Answer a few questions

1. Choose **From anywhere, at an address of my own**.
2. Type the address, like `conch.yourname.com`.
3. If it doesn't point to your server yet, Conch shows the record to add at your domain provider, filled in. It notices when you have, usually in a minute or two.
4. If the firewall blocks ports 80 and 443, Conch shows the command to open them and runs it when you say yes. That may ask for your password once.
5. Conch gets a Let's Encrypt certificate and answers at `https://` your address.

It ends with a link and a QR code.

## Make it yours

Open the link on your own computer or phone. Choose your passkey (**Use Touch ID**, Windows Hello or Face ID) or **Choose a password instead**. Conch is now yours.

Whoever opens the link first owns this Conch, so keep it private. It works once, for an hour. `conch hello` on the server makes a new one.

## Your other devices

- **With a passkey** that syncs (iCloud Keychain, Google Password Manager), they come straight in.
- **With a password**, a new device waits until you approve it in **Settings → Access** on a signed-in device, after confirming it's you.
- **Your phone:** in **Settings → Access**, press **Add a device** and scan the code.

Approval is on from the start, so a leaked password gets nobody in.

## Good to know

- **Renewals are automatic.** **Settings → Health** says when, and **Repair everything** checks it.
- **Lost your way in?** On the server, `conch reset` forgets every way in, then `conch hello` gives a new link.
- **Already run a tunnel or web server?** Choose **Through a tunnel or web server I already run** (Cloudflare Tunnel, nginx, Caddy). Conch says where to point it, checks it and ends with the same link. It names any program already on ports 80 and 443. See [Behind a tunnel or reverse proxy](../security/reverse-proxy.md).
- **Rather keep it private?** Choose **Only from my own devices**. Conch uses [Tailscale](./phone.md) and opens nothing to the internet.
- **Change it later** with `conch setup`, or in **Settings → Security → Advanced → Your address**.
- **Many servers?** Add `--domain conch.yourname.com` to the install line to skip the first two questions, or `--proxy conch.yourname.com` behind your own tunnel.
