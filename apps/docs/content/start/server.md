---
title: On a server
description: Put Conch on a server you rent and open it at your own address. One line to install, a few answers, and a link that makes it yours.
order: 1.7
---

A server that stays on means routines run on time and your assistant is there from any device. Conch can answer at an address of your own, like `conch.yourname.com`, and it handles the secure connection itself. There is no proxy to set up and no file to edit.

## What you need

- A server running Linux, with SSH. Any small one works: 2 GB of memory is comfortable.
- A domain you own, or a subdomain of it.

## Install

Connect to your server and run:

<!-- conch:install-server -->

Conch installs, starts, and asks how you'll reach it.

## Answer a few questions

1. Choose **From anywhere, at an address of my own**.
2. Type the address you want, like `conch.yourname.com`.
3. If it doesn't point to your server yet, Conch shows the one record to add at your domain provider, with your server's address filled in. Add it, and Conch notices by itself. This usually takes a minute or two.
4. Conch makes sure ports 80 and 443 can reach it. If your server's firewall is closed, it shows the command to open them and runs it when you say yes. That may ask for your password once.
5. Conch gets its certificate from Let's Encrypt and starts answering at `https://` your address.

At the end, it shows a link and a QR code.

## Make it yours

Open the link on your own computer or phone. Choose **Use Touch ID** (or Windows Hello, or Face ID, whatever your device has), or **Choose a password**. That's it: you're signed in, and Conch is yours.

Whoever opens the link first owns this Conch, so keep it to yourself. It works once, for an hour. Need another one? Run `conch hello` on the server.

## Your other devices

- **With a passkey** that syncs (iCloud Keychain, Google Password Manager), your other devices sign in with it and come straight in.
- **With a password**, a new device waits for your OK. Approve it in **Settings → Security** on a device you've already signed in on. You'll be asked to confirm it's you first.
- **Your phone:** in **Settings → Devices**, press **Add a device** and scan the code.

New devices need your approval from the start, so a password someone learns gets them nowhere.

## Good to know

- **Renewals are automatic.** Conch renews its certificate long before it runs out. **Settings → Health** says when, and **Repair everything** checks it.
- **Lost your way in?** On the server, `conch reset` turns sign-in off, then `conch hello` gives you a new link.
- **Already run a tunnel or a web server?** Choose **Through a tunnel or web server I already run** instead, for a Cloudflare Tunnel, nginx or Caddy. Conch says where to point it, checks the way in through it, and ends with the same link. If something else answers on ports 80 and 443, Conch says which program it is. See [Behind a tunnel or reverse proxy](../security/reverse-proxy.md).
- **Rather keep it private?** Choose **Only from my own devices** instead. Conch then uses [Tailscale](./phone.md), and nothing is opened to the internet.
- **Change it later** with `conch setup`, or in **Settings → Security → Advanced → Your address**.
- **Setting up many servers?** Add `--domain conch.yourname.com` to the install line, and Conch skips the first two questions. Behind a tunnel of your own, it's `--proxy conch.yourname.com`.
