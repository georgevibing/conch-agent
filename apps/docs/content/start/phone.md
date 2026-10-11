---
title: On your phone
description: Conch stays on your computer. Your phone reaches it over an encrypted address that only your own devices can open.
order: 3
---

## Sign your phone in

1. Install [Tailscale](https://tailscale.com/download) on your computer and phone, and sign in to both. It's free, and opens nothing to the internet.
2. In **Settings → Access**, choose a passkey (Touch ID, Windows Hello) or a password.
3. Press **Add a device**. Conch turns on its secure address and shows a QR code.
4. Scan it with your phone's camera. You're signed in.

The code works once, for ten minutes, for whoever opens it. Don't share it.

In a terminal, `conch phone` turns the address on and `conch pair` shows the code.

## Make it an app

Add Conch to your Home Screen (in Safari: **Share → Add to Home Screen**). It opens like an app, no app store.

## Made for the small screen

On a phone, Conch keeps the chat's name in view and folds the rest away.

- **Header:** your provider's mark, with a ring for how much of its limit is left. **⋯** holds **Find in chat**, the browser and the terminal.
- **Message box:** one line. One chip shows model and mode ("Opus · Auto"); tap it for both, and the folder. **Talk** replaces Send until you type.
- **Working folder:** **Change** beside **Folder** in that sheet, `/folder`, or **Settings → General**. You browse the computer's folders.
- **Filters** that don't fit (**Apps** and elsewhere) slide sideways; the page never does.

## Let it reach you

Turn on **Allow notifications** in **Settings → Notifications**. Conch tells you when it needs your OK or has a question, when an answer is ready while you're away, and when a routine has run. Never while you're looking at it.

**Topics** sets what this device hears about. Turn off **Show what it’s about** and a notification only says to open Conch. **Send a test** sends one now.

### Answer from the notification

The notification says what your assistant wants in a few words: "Run git and Python in conch-agent", never the command itself.

- **Allow** and **Deny** are on it for everyday steps (running tests, building, changing a file in the work folder). It then says **Allowed** or **Denied**.
- **Review** replaces them for steps that matter: deleting, sending to others, spending, using your Passwords, acting on a website or in your apps, changing files outside the work folder, a plan to read, or anything after the chat read something from outside. It opens Conch at the question.
- **Tapping it** opens a sheet: who's asking, the few words, exactly what it would do, and two big buttons. **Show all** expands a long command. For a step that matters, **Confirm and allow** asks for your passkey (Face ID, a fingerprint) or password.
- **In the chat**, on any device but the computer Conch runs on, allowing a step that matters asks you to confirm it's you, then not again for ten minutes.
- **iPhone** notifications have no buttons; a tap opens the sheet.
- **With Show what it’s about off**, there's no **Allow**: you'd be allowing something unseen.
- **Each tap works once**, on the phone it was sent to, while the question waits. Answered elsewhere, it says **Already answered**.

Unanswered for 30 minutes is a no, and the chat says so.

**Settings → Access → Devices** lists every signed-in phone, tablet and browser. A bell marks those that get notifications. **Stop notifications** quiets one; **Sign out** removes it.

## Talk to it

Dictate, hear answers read aloud, or talk hands free, with your voice kept on your phone or the computer Conch runs on. Say **“Hey Conch”** (or your assistant's name) while Conch is open. See [Voice](../features/voice.md).

## Or skip the browser

Reach your assistant from Telegram, Discord, Slack, WhatsApp, Signal, iMessage, email, SMS, Microsoft Teams, Google Chat, Matrix, Mattermost, Rocket.Chat, WeChat, LINE, Feishu / Lark, DingTalk or QQ, and approve from there. Set it up in [**Apps → Talk to me here**](../channels/index.md).

> [!NOTE]
> Other ways in, a second lock for new devices, and what to do about a lost phone are in [Signing in and staying safe](../security/signing-in.md).
