---
title: On your phone
description: Conch stays on your computer. Your phone reaches it over an encrypted address that only your own devices can open.
order: 3
---

## Sign your phone in

1. Install [Tailscale](https://tailscale.com/download) on your computer and your phone, and sign in to both. It's free, and nothing is opened to the internet.
2. In Conch, choose a password in **Settings → Security**.
3. Press **Add a device**. Conch turns on its secure address with one press, then shows a QR code.
4. Point your phone's camera at it. Your phone is signed in.

The code works once, for ten minutes. Whoever opens it is signed in, so don't share it.

Prefer the terminal? `pnpm conch phone` turns the address on, and `pnpm conch pair` shows the code.

## Make it an app

In your phone's browser, add Conch to the Home Screen (in Safari: **Share → Add to Home Screen**). It opens like any app, with no app store.

## Let it reach you

Turn on notifications in **Settings → Notifications**. Conch tells you when it needs your OK (with **Deny** right there), when an answer is ready while you're away, and when a routine has run. It never notifies you while you're looking at it.

## Talk to it

Dictate into any message, have answers read aloud, or talk hands free. Your voice can stay on your own devices: on the phone itself, or on the computer Conch runs on.

## Or skip the browser

Reach your assistant from Telegram, Discord, Slack, WhatsApp, Signal, iMessage, email, Microsoft Teams, Matrix or WeChat, and approve what it asks from there. See [Channels](../channels/index.md).

> [!NOTE]
> Other ways in, a second lock for new devices, and what to do about a lost phone are in [Signing in and staying safe](../security/signing-in.md).
