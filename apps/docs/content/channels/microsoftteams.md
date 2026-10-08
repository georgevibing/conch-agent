---
channel: microsoftteams
---

## Connect it

In Conch, open **Apps**, choose **Talk to me here**, then **Microsoft Teams**. You make a Teams bot of your own, Conch gives it an address Teams can deliver to, and you add it to Teams.

1. **Make the bot.** Open the Teams Developer Portal and sign in with your work or school account. Press **New Bot**, name it after your assistant and press **Add**. If your organisation makes bots in Azure instead, an Azure Bot works the same.
2. **Copy its ID and a secret.** On the bot's page, copy the **Bot ID**. Open **Client secrets**, press **Add a client secret for your bot** and copy the secret it shows. Conch checks both with Microsoft. If your bot only works in your organisation, Conch asks for its **Directory (tenant) ID** too.
3. **Give it an address Teams can reach.** Press **Turn on with Tailscale**. If you already run a reverse proxy or a tunnel, choose **I have an address of my own** instead.
4. **Tell Teams where to deliver.** On the bot's page, open **Configure**, paste the **Endpoint address** Conch shows, and press **Save**.
5. **Add it to Teams.** Press **Download the Teams app**. In Teams, open **Apps** → **Manage your apps** → **Upload an app** → **Upload a custom app**, choose the file and press **Add**.
6. **Say hello.** Open the bot in Teams and send it anything. Conch asks **Is this you?** with your name. Press **That's me**.

<!-- conch:channel-scene microsoftteams key -->

## The address Teams delivers to

Teams only delivers a bot's messages to a web address. Conch gives it one that leads to a small door of its own, not to Conch itself. The door lets in nothing but messages Microsoft signed for your bot, and Conch checks each signature before it reads a word.

<!-- conch:channel-scene microsoftteams endpoint -->

## Your first hello

<!-- conch:channel-scene microsoftteams hello -->

## Good to know

- **No Upload an app in Teams?** Your organisation turned custom apps off. Ask whoever runs Teams for you to allow it, or to upload the file for you.
- **Approvals come as a card** with **Allow**, **Always in this chat** and **Don't allow**.
- **Commands are in the app's menu.** Teams lists ten of Conch's: `/new`, `/stop`, `/model`, `/clear`, `/plan`, `/goal`, `/effort`, `/retry`, `/status` and `/help`. Every other one works when you type it. See [Slash commands](../reference/slash-commands.md#in-chat-apps).
- **While it works** Teams shows "typing…".
- **Files you send** in the chat come too: the app asks Teams for that.
- **Pictures from Conch** (a picture it made) arrive in the chat: PNG, JPEG or GIF, up to 1 MB each. Other files can't go to Teams from Conch, and your assistant says so; they're in the chat in Conch.
- **Turn the address off** under the channel's **Where Teams delivers** when you stop using Teams.
