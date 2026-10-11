---
title: Add any chat app
description: Talk to your assistant on a chat app Conch doesn't list. Name it and Conch makes it, or add one from a shared link.
---

Any app with bots works like the listed ones: your hello, **Let them in** and **Block**, approvals in the chat, and routine results.

## Make one with Conch

1. Open **Apps → Talk to me here**. Under **Not here? Add your own**, type its name, like “Zulip”, and press **Connect it with Conch**. Or say “connect me on Zulip” in any chat.
2. Conch reads the app's bot documentation and makes it.
3. Follow the card under the reply to make the bot. Paste what the app gives you, like the bot's token, and press **Test it**.
4. Press **Add**, say hello to the bot from the app, and press **That's me** in Conch.

The assistant never sees the token. You type it into the card, and Conch keeps it with your other keys.

## Add one from a link

Under **Not here? Add your own**, choose **Add from a link** and paste the GitHub address or a `.conchapp` file's address. Conch shows what it is and who made it. Paste the token, press **Test it**, then **Add**.

## Good to know

- **It only carries messages.** It can't read your chats, use your apps or see any other key.
- **Nobody gets in by default.** The first hello waits for **That's me**.
- **From someone else, approvals wait in Conch.** Its questions and settings are answered in Conch, never in the app.
- **One you made asks in the app**, with buttons or numbered answers.
- **No public address, usually.** Conch asks the app for new messages. An app that only delivers to a web address uses [the public door](index.md#a-bot-of-your-own).
- **It's a Conch app** in **Apps**, marked **Made by you** or **Added from a link**. Removing it disconnects it.
- **When it stops working,** **Repair everything** offers **Ask Conch to fix it**.
- Every field: [The app manifest](../reference/app-manifest.md).
