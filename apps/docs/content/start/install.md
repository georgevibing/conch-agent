---
title: Install
description: Download the app, or use one line in a terminal. Either way there is nothing to install first.
order: 1
---

## The app

<!-- conch:download -->

When a desktop download is available, open the downloaded file and Conch opens. Everything it needs comes with it. [The app](./app.md) says what's different about it, and what to do if your computer asks before opening it.

## One line in a terminal

<!-- conch:install -->

That is the whole setup. The line does three things:

1. Gets Node.js and Git if you don't have them. Node.js goes into Conch's own folder, checked against its checksum. On Linux, installing Git may ask for your administrator password.
2. Builds Conch and keeps it running in the background, so it's there when you log in.
3. Adds **Conch** to your apps and opens it.

Conch then looks for what you already have, helps you [connect a provider](./first-chat.md), and asks a couple of optional questions so it can be yours.

## If the installer asks for permission

On Linux and macOS, Conch checks the tools its terminal needs before installing its parts. If any are missing, it shows what it will install and asks first. On Debian and Ubuntu, these are `build-essential` and `python3`. Only system-package installation uses administrator access. Conch itself runs as you.

You can say no. Conch still installs, and full terminals can use Python 3 instead. If neither option is available, terminal commands work in basic mode, without full-screen programs. The installer tells you which one is ready.

To skip optional system packages, add `--no-system-packages` (Git must already be installed). With no keyboard available, the installer never waits for an administrator password. It leaves system packages alone and continues with the terminal fallback.

## Update or remove

Run the same line again to update. Conch also updates itself with one click, in **Settings → Health**.

To remove it, add `--uninstall`. Your chats and memories stay unless you also add `--delete-data`.

```bash
curl -fsSL https://conchagent.com/install.sh | sh -s -- --uninstall
```

On Windows, set `$env:CONCH_UNINSTALL = '1'` and run the line again.

## A computer that stays on

For a server you rent, a Mac mini or a Raspberry Pi in a cupboard, add `--server`. Conch opens no browser and keeps running after you log out. Then it asks how you'll reach it: at an address of your own, privately with Tailscale, or only from that computer. It ends with a link that makes it yours.

```bash
curl -fsSL https://conchagent.com/install.sh | sh -s -- --server
```

Over SSH, it does this by itself. [On a server](./server.md) walks through it.

## The conch command

The installer adds `conch` to your terminal, so `conch help`, `conch status` and the rest work anywhere. Every command is in [the command line](../reference/cli.md).

## From a checkout

With Node 24 or newer:

```bash
corepack enable
pnpm install
pnpm start
```

Conch builds and opens at `http://localhost:4317`, reachable only from this computer. If another program has that port, it takes the next free one and says so.

Conch trusts a browser it opened itself. To use another browser on this computer, run `pnpm conch open --link` and paste the link it prints. [This computer](../security/signing-in.md#this-computer) says why.
