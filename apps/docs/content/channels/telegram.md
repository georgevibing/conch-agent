---
channel: telegram
---

## Connect it

Open **Apps → Talk to me here → Telegram**. The page fills in the answers for each step.

1. **Make your bot.** In Telegram, open **BotFather** and send `/newbot`. Give it the name and username Conch suggests. If the username is taken, change the number. It has to end in "bot".
2. **Paste its key.** Copy the key BotFather replies with, or the whole message, and paste it anywhere in Conch. Conch checks it and connects.
3. **Say hello.** Open the link Conch shows, or scan its QR code, and press **START** in Telegram. The bot greets you by name. The link works once, for ten minutes.

<!-- conch:channel-scene telegram key -->

## Your first hello

<!-- conch:channel-scene telegram hello -->

## Choose a model and settings

Type `/` for Telegram's menu of Conch's commands.

- `/model` shows your models as buttons, the one in use ticked. Tap another to switch.
- `/effort`, `/fast` and `/mode` work the same way.
- `/clear`, `/goal` and `/plan` do what they do in Conch.
- `/status` shows what this chat uses, and `/settings` has everything else.

See [Slash commands](../reference/slash-commands.md#in-chat-apps) and [Choose how Conch works here](index.md#choose-how-conch-works-here).

## Good to know

- **Answers arrive as they're written**, as a draft with Telegram's own Stop button.
- **Pictures and files.** Pictures arrive as photos with a caption, several as an album. Other files arrive as documents, up to 50 MB. A picture over Telegram's 10 MB photo limit comes whole, as a document.
- **One program per bot.** If another program reads your bot's messages, Conch says so and tries again every minute. A leftover webhook from another tool is removed for you.
- **Groups:** add the bot, then turn the group on in Conch. It answers `@yourbot` and replies to it. See [In a group](index.md#in-a-group).
