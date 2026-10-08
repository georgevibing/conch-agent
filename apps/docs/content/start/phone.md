---
title: On your phone
description: Conch stays on your computer. Your phone reaches it over an encrypted address that only your own devices can open.
order: 3
---

## Sign your phone in

1. Install [Tailscale](https://tailscale.com/download) on your computer and your phone, and sign in to both. It's free, and nothing is opened to the internet.
2. In Conch, choose how you sign in, in **Settings → Security**: a passkey (Touch ID, Windows Hello) or a password.
3. In **Settings → Devices**, press **Add a device**. Conch turns on its secure address with one press, then shows a QR code.
4. Point your phone's camera at it. Your phone is signed in.

The code works once, for ten minutes. Whoever opens it is signed in, so don't share it.

Prefer the terminal? `conch phone` turns the address on, and `conch pair` shows the code.

## Make it an app

In your phone's browser, add Conch to the Home Screen (in Safari: **Share → Add to Home Screen**). It opens like any app, with no app store.

## Made for the small screen

On a phone, Conch keeps the chat's name in view and folds the rest away. The header shows your provider's mark and how much of its limit is left as a ring; **⋯** holds **Find in chat**, the browser and the terminal. The message box keeps to one line: the model by name, the mode as its icon (tap it to see which), and **Talk** in Send's place until you type. To choose the working folder, type `/folder` or open **Settings → General**: your phone walks through the computer's folders, the same as at the computer. Filters that don't fit (in **Apps**, **Activity** and elsewhere) slide sideways, and the page itself never does.

## Let it reach you

Turn on **Allow notifications** in **Settings → Notifications**. Conch tells you when it needs your OK or has a question for you, when an answer is ready while you're away, and when a routine has run. It never notifies you while you're looking at it.

While it's on, **Tell me when** lists what this device hears about, one switch each. Turn off **Show what it's about** and a notification only says to open Conch. **Send a test** sends one now, to see it arrive.

### Answer from the notification

When your assistant needs your OK, the notification says what it wants to do.

- **Allow** and **Deny** are right on it for everyday steps: running the tests, building, changing a file in the work folder. One tap, and it carries on. The notification says **Allowed** or **Denied**.
- **Review** is there instead for a step that matters: anything that deletes, sends something to other people, spends money, acts in one of your apps, or comes after the chat read something from outside. It opens Conch at the question.
- Tapping the notification opens the question in a sheet at the bottom of the screen: who's asking, exactly what it would do, and two big buttons. For a step that matters, **Confirm and allow** asks for your passkey (Face ID, a fingerprint) or your password first.
- On an iPhone, notifications have no buttons, so a tap opens the sheet.
- With **Show what it's about** off, there's no **Allow**: you'd be allowing something you can't see.
- Each tap works once, only on the phone it was sent to, and only while the question waits. Answered somewhere else first, the notification says **Already answered**.

A question nobody answers in 30 minutes is a no, and the chat says so.

**Settings → Devices** lists every phone, tablet and browser signed in to Conch. A bell beside one means it gets notifications; press **Stop notifications** to quiet it and leave it signed in, or **Sign out** to send it away.

## Talk to it

Dictate into any message, have answers read aloud, or talk hands free. Your voice can stay on your own devices: on the phone itself, or on the computer Conch runs on. Say **“Hey Conch”** (or your assistant's name) while Conch is open on the phone, too. See [Voice](../features/voice.md).

## Or skip the browser

Reach your assistant from Telegram, Discord, Slack, WhatsApp, Signal, iMessage, email, Microsoft Teams, Matrix or WeChat, and approve what it asks from there. It's in **Apps → Talk to me here**. See [Talk to me here](../channels/index.md).

> [!NOTE]
> Other ways in, a second lock for new devices, and what to do about a lost phone are in [Signing in and staying safe](../security/signing-in.md).
