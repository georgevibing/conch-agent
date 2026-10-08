---
channel: discord
---

## Connect it

In Conch, open **Apps**, choose **Talk to me here**, then **Discord**. The page walks you through these.

1. **Make a Discord app.** Open the [Developer Portal](https://discord.com/developers/applications), press **New Application**, name it after your assistant, tick the box and press **Create**.
2. **Copy its token.** In your app, open **Bot**, press **Reset Token**, confirm, then **Copy**. Paste it anywhere on Conch's page. Discord shows a token once: if you lose it, press **Reset Token** again.
3. **Add it to your server.** Discord only lets you message a bot you share a server with. Conch makes the invite link; the bot gets no permissions there, so it can't read or post anything. This step ticks itself off when the bot arrives.
4. **Say hello.** Send your bot a private message. Conch asks **Is this you?** with your name and the message. Press **That's me**.

<!-- conch:channel-scene discord key -->

No server of your own? In Discord, press **+** in the list of servers, then **Create My Own**. It takes ten seconds.

## Your first hello

Once Conch knows it's you, the bot greets you by name.

<!-- conch:channel-scene discord hello -->

## Good to know

- **Nothing to switch on.** The bot needs no special settings in the portal: Conch handles them.
- **Conch's commands are in Discord's `/` menu.** Type `/` in your chat with the bot to pick `/model`, `/clear`, `/goal`, `/plan` and the rest, with a box for what goes after it. Discord shows what you chose to you alone, and the answer arrives as usual. See [Slash commands](../reference/slash-commands.md#in-chat-apps).
- **While it works** you see Discord's "typing…".
- **Pictures and files.** A picture Conch makes, or a file it finishes, arrives as an attachment, with its words on the message: up to ten on a message, and 10 MB a file (what Discord lets bots send to a server without boosts).
- **Private messages, and server channels you turn on.** A server channel where someone mentions the bot shows on its page in Conch, off. Turn it on there, and it answers whoever mentions it: you as in private, everyone else in words only. See [In a group](index.md#in-a-group).
