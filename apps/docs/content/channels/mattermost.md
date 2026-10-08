---
channel: mattermost
---

## Connect it

Your assistant gets a bot account on your Mattermost server. In Conch, open **Apps**, choose **Talk to me here**, then **Mattermost**.

1. **Make a bot account.** In Mattermost, open the menu → **Integrations** → **Bot Accounts** → **Add Bot Account**. Conch suggests the username and display name. Press **Create Bot Account** and copy the token it shows: it's shown once.
2. **Paste the address and the token.** The address is the one you open Mattermost at, like `https://chat.example.com`. Conch checks the token with your server and connects. There is no Save button.
3. **Say hello.** In Mattermost, open a direct message with the bot and send it anything. Then press **That's me** in Conch.

<!-- conch:channel-scene mattermost key -->

## Your first hello

Once Conch knows it's you, the bot greets you by name.

<!-- conch:channel-scene mattermost hello -->

## Good to know

- **No public address.** Conch connects to your server from this computer, over Mattermost's own WebSocket, so your server only has to be reachable from here.
- **No Bot Accounts in the menu?** Someone who runs the server turns them on in **System Console → Integrations → Bot Accounts**.
- **Answers keep their formatting**: Mattermost writes Markdown, as Conch does.
- **Pictures and files.** A picture Conch makes, or a file it finishes, arrives attached to a post with its words, five to a post. A file over the server's **Maximum File Size** (System Console → File Storage) can't go, and Conch says so.
- **Approvals.** Mattermost's buttons need the server to reach Conch, so the question comes with numbered answers: reply with the number.
- **In a channel**, invite the bot (`/invite @yourbot`). When someone mentions it, the channel shows on its page in Conch, off. Turn it on there, and it answers whoever mentions it: you as in private, everyone else in words only. See [In a group](index.md#in-a-group).
- **A token that stops working** (revoked, or the bot turned off) stops this channel only. Make a new token on the bot's page and paste it.
