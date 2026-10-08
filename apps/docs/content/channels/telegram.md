---
channel: telegram
---

## Connect it

In Conch, open **Apps**, choose **Talk to me here**, then **Telegram**. The page walks you through these, and works out the answers for you.

1. **Make your bot.** In Telegram, open **BotFather** and send `/newbot`. It asks for a name and a username; Conch suggests both. If the username is taken, change the number. It has to end in "bot".
2. **Paste its key.** BotFather replies with a key. Copy it, or the whole message, and paste it anywhere on Conch's page. Conch checks it with Telegram and connects. There is no Save button.
3. **Say hello.** Open the link Conch shows, or scan its QR code, and press **START** in Telegram. That first message tells Conch the bot is yours.

<!-- conch:channel-scene telegram key -->

## Your first hello

The link opens your bot in Telegram with one button, **START**. Press it and the bot greets you by name. The link works once, for ten minutes.

<!-- conch:channel-scene telegram hello -->

## Choose a model and settings

Type `/` and Telegram's own menu lists Conch's commands. `/model` shows your models as buttons, the one in use ticked: tap another and it's done. `/effort`, `/fast` and `/mode` work the same way, `/clear`, `/goal` and `/plan` do what they do in Conch, and `/status` shows what this chat uses. `/settings` has everything else. See [Slash commands](../reference/slash-commands.md#in-chat-apps) and [Choose how Conch works here](index.md#choose-how-conch-works-here).

## Good to know

- **Answers arrive as they're written.** Telegram shows the reply as a draft while your assistant works, with its own Stop button.
- **Pictures and files.** A picture your assistant makes arrives as a photo with a caption, several as an album; other files arrive as documents. A picture over Telegram's 10 MB for photos comes as a document instead, whole; files go up to 50 MB.
- **One program per bot.** Telegram lets only one program read a bot's messages. If another has yours, Conch says so, waits, and retries every minute.
- **A leftover webhook** from another tool is removed for you.
- **In a group**, add the bot like any member. It shows on its page in Conch, off; turn it on there, and it answers when someone writes `@yourbot` or replies to it. See [In a group](index.md#in-a-group).
