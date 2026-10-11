---
channel: microsoftteams
---

## Connect it

You make a Teams bot and add it to Teams. Open **Apps → Talk to me here → Microsoft Teams**.

1. **Make the bot.** In the Teams Developer Portal, sign in with your work or school account. Press **New Bot**, name it after your assistant and press **Add**. An Azure Bot works the same.
2. **Copy its ID and a secret.** On the bot's page, copy the **Bot ID**. Open **Client secrets**, press **Add a client secret for your bot** and copy the secret. For a bot that only works in your organisation, Conch also asks for its **Directory (tenant) ID**.
3. **Give it an address Teams can reach.** Press **Turn on with Tailscale**, or choose **I have an address of my own** for your own reverse proxy or tunnel.
4. **Tell Teams where to deliver.** On the bot's page, open **Configure**, paste the **Endpoint address** Conch shows, and press **Save**.
5. **Add it to Teams.** Press **Download the Teams app**. In Teams, open **Apps → Manage your apps → Upload an app → Upload a custom app**, choose the file and press **Add**.
6. **Say hello.** Send the bot anything in Teams. Conch asks **Is this you?**. Press **That's me**.

<!-- conch:channel-scene microsoftteams key -->

## The address Teams delivers to

It leads to a small door, not to Conch, that lets in only messages Microsoft signed for your bot.

<!-- conch:channel-scene microsoftteams endpoint -->

## Your first hello

<!-- conch:channel-scene microsoftteams hello -->

## Good to know

- **No Upload an app?** Your organisation turned custom apps off. Ask your Teams admin to allow it, or to upload the file.
- **Approvals come as a card** with **Allow**, **Always in this chat** and **Don't allow**.
- **The app's menu lists ten commands:** `/new`, `/stop`, `/model`, `/clear`, `/plan`, `/goal`, `/effort`, `/retry`, `/status` and `/help`. The rest work when you type them. See [Slash commands](../reference/slash-commands.md#in-chat-apps).
- **While it works**, Teams shows "typing…". Files you send come too.
- **Pictures from Conch** arrive in the chat: PNG, JPEG or GIF, up to 1 MB each. Other files stay in the chat in Conch, and your assistant says so.
- **Turn the address off** under **Where Teams delivers** when you stop using Teams.
