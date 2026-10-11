---
channel: rocketchat
---

## Connect it

Your assistant gets a bot user on your Rocket.Chat server. Open **Apps → Talk to me here → Rocket.Chat**.

1. **Make a bot user and its token.** In Rocket.Chat, open **Administration → Users → New user**, with the username and name Conch suggests. Give it the **bot** role and save. Signed in as that user, open **Profile → Personal Access Tokens**, turn on **Ignore Two Factor Authentication**, and add a token. Copy the token and the user id. They're shown once.
2. **Paste the address, the user id and the token.** The address is where you open Rocket.Chat, like `https://chat.example.com`. Conch checks them and connects.
3. **Say hello.** Send the bot a direct message, then press **That's me** in Conch.

<!-- conch:channel-scene rocketchat key -->

## Your first hello

<!-- conch:channel-scene rocketchat hello -->

## Good to know

- **Your server only has to be reachable from this computer.** Conch connects over Rocket.Chat's own realtime connection.
- **Answers keep their formatting.** Rocket.Chat writes Markdown too.
- **Pictures and files** from Conch arrive as uploads, one to a message, with the words on the first. A file over the server's **Maximum File Upload Size** (**Administration → File Upload**) can't go, and Conch says so.
- **Approvals** come with numbered answers. Reply with the number.
- **Channels:** add the bot, then turn the channel on in Conch. See [In a group](index.md#in-a-group).
- **Token stopped working?** Make a new one for the bot and paste it.
