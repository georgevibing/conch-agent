---
title: Install
description: One line, and nothing to install first. Conch gets what it needs, builds itself and opens.
order: 1
---

<!-- conch:install -->

That is the whole setup. The line does three things:

1. Gets Node.js and Git if you don't have them. They go into Conch's own folder, checked against their checksums, and nothing needs an administrator.
2. Builds Conch and keeps it running in the background, so it's there when you log in.
3. Adds **Conch** to your apps and opens it.

Conch then looks for what you already have, helps you [connect a provider](./first-chat.md), and asks a couple of optional questions so it can be yours.

## Update or remove

Run the same line again to update. Conch also updates itself with one click, in **Settings → Health**.

To remove it, add `--uninstall`. Your chats and memories stay unless you also add `--delete-data`.

```bash
curl -fsSL https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.sh | sh -s -- --uninstall
```

On Windows, set `$env:CONCH_UNINSTALL = '1'` and run the line again.

## A computer that stays on

For a Mac mini or a Raspberry Pi in a cupboard, add `--server`. Conch opens no browser, keeps running after you log out, and prints your phone's secure address with a QR code to sign it in.

```bash
curl -fsSL https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.sh | sh -s -- --server
```

## From a checkout

With Node 24 or newer:

```bash
corepack enable
pnpm install
pnpm start
```

Conch builds and opens at `http://localhost:4317`, reachable only from this computer. If another program has that port, it takes the next free one and says so.
