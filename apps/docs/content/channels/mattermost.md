---
channel: mattermost
---

## Connect it

Your assistant gets a bot account on your Mattermost server. Open **Apps → Talk to me here → Mattermost**.

1. **Make a bot account.** In Mattermost, open the menu → **Integrations → Bot Accounts → Add Bot Account**, with the username and display name Conch suggests. Press **Create Bot Account** and copy the token. It's shown once.
2. **Paste the address and the token.** The address is where you open Mattermost, like `https://chat.example.com`. Conch checks the token and connects.
3. **Say hello.** Send the bot a direct message, then press **That's me** in Conch.

<!-- conch:channel-scene mattermost key -->

## Your first hello

<!-- conch:channel-scene mattermost hello -->

## Good to know

- **Your server only has to be reachable from this computer.** Conch connects over Mattermost's own WebSocket.
- **No Bot Accounts in the menu?** A server admin turns them on in **System Console → Integrations → Bot Accounts**.
- **Answers keep their formatting.** Mattermost writes Markdown too.
- **Pictures and files** from Conch arrive attached to a post with its words, five to a post. A file over the server's **Maximum File Size** (**System Console → File Storage**) can't go, and Conch says so.
- **Approvals** come with numbered answers, since Mattermost's buttons need the server to reach Conch. Reply with the number.
- **Channels:** invite the bot (`/invite @yourbot`), then turn the channel on in Conch. See [In a group](index.md#in-a-group).
- **Token stopped working** (revoked, or the bot turned off)? Make a new one on the bot's page and paste it.
