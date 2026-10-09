---
title: Add any chat app
description: Talk to your assistant on a chat app Conch doesn’t list, made with Conch from its name, or added from a link someone shared.
---

Conch lists the chat apps most people use. For any other app with a bot of its own, add your own. It works like the others: your hello, **Let in** and **Block**, approvals in the chat, and routine results.

## Make one with Conch

1. Open **Apps**, choose **Talk to me here**, and under **Not here? Add your own**, type its name, like “Zulip”. Press **Connect it with Conch**. Or say it in any chat: “connect me on Zulip”.
2. Conch opens a chat, reads the app's bot documentation, and makes it.
3. A card appears under the reply, with the steps to make the bot in that app. Paste what it gives you, like the bot's token, and press **Test it**: Conch says who the bot is.
4. Press **Add**, then say hello to the bot from the app. In Conch, press **That's me**.

The assistant never sees the bot's token. You type it into the card, and Conch keeps it with your other channels' keys.

## Add one from a link

Someone shared one? Choose **Add from a link** under **Not here? Add your own**, and paste the GitHub address, or the address of a `.conchapp` file. Conch shows what it is and who made it. Paste the token, press **Test it**, then **Add**.

## Good to know

- **It only carries messages.** A chat app's code hands Conch the messages it gets, and sends what Conch gives it. It can't read your chats, use your apps or see any other key.
- **Nobody gets in by default.** The first hello waits for you to press **That's me**, as with every chat app.
- **From someone else, approvals wait in Conch.** A chat app made by someone else could speak for you, so its questions and settings are answered in Conch, never in the app. One you made in Conch asks in the app, with buttons where the app has them and numbered answers where it doesn't.
- **No public address, usually.** Conch asks the app for new messages from this computer. An app that only delivers to a web address uses [the public door](index.md).
- **It's a Conch app.** It's in **Apps**, marked **Made by you** or **Added from a link**. Taking it away disconnects it.
- **When it stops working,** **Repair everything** offers **Ask Conch to fix it**.
- See [The app manifest](../reference/app-manifest.md) for every field.
