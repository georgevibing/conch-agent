---
title: Install
description: Download the app, or run one line in a terminal. Either way, there is nothing to install first.
order: 1
---

## The app

<!-- conch:download -->

Open the file and Conch opens, with everything it needs inside. See [the app](./app.md), including what to do if your computer asks first.

## One line in a terminal

<!-- conch:install -->

That is the whole setup. The line:

1. Gets Node.js and Git if missing. Node.js goes into Conch's own folder, checked against its checksum. On Linux, Git may ask for your administrator password.
2. Installs the newest release (stable, else beta, else alpha), checked against Conch's signing keys.
3. Builds Conch and keeps it running in the background, from login.
4. Adds **Conch** to your apps and opens it.

Conch then finds what you have, helps you [connect a provider](./first-chat.md), asks your name and offers something to ask first.

## If the installer asks for permission

On Linux and macOS, Conch checks the tools its terminal needs. If any are missing (`build-essential` and `python3` on Debian and Ubuntu), it shows what it will install and asks first.

- Only system packages use administrator access. Conch runs as you.
- Say no and Conch still installs. Full terminals use Python 3 instead, or else basic mode, without full-screen programs. The installer says which.
- `--no-system-packages` skips them. Git must already be installed.
- With no keyboard, it never waits for a password. It skips system packages and uses the fallback.

## Update or remove

Run the same line again to update, or press **Update Conch** in **Settings → Health**.

To remove Conch, add `--uninstall`. Your chats and memories stay unless you also add `--delete-data`.

```bash
curl -fsSL https://conchagent.com/install.sh | sh -s -- --uninstall
```

On Windows, set `$env:CONCH_UNINSTALL = '1'` and run the line again.

## A computer that stays on

For a rented server, a Mac mini or a Raspberry Pi, add `--server`. Conch opens no browser, keeps running after you log out, asks how you'll reach it (your own address, Tailscale, or that computer only) and ends with a link that makes it yours.

```bash
curl -fsSL https://conchagent.com/install.sh | sh -s -- --server
```

Over SSH, it does this by itself. See [On a server](./server.md).

## The conch command

The installer adds `conch` to your terminal: `conch help`, `conch status` and the rest work anywhere. See [the command line](../reference/cli.md).

## From a checkout

With Node 24 or newer:

```bash
corepack enable
pnpm install
pnpm start
```

Conch builds and opens at `http://localhost:4317`, reachable only from this computer. If that port is taken, it uses the next free one and says so.

Conch trusts a browser it opened itself. For another browser here, run `pnpm conch open --link` and paste the link. [This computer](../security/signing-in.md#this-computer) says why.
