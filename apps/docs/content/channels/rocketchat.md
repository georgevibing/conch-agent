---
channel: rocketchat
---

## Connect it

Your assistant gets a bot user on your Rocket.Chat server. In Conch, open **Apps**, choose **Talk to me here**, then **Rocket.Chat**.

1. **Make a bot user and its token.** In Rocket.Chat, open **Administration → Users → New user**. Conch suggests the username and name. Give it the **bot** role and save. Then, signed in as that user, open **Profile → Personal Access Tokens**, turn on **Ignore Two Factor Authentication**, and add a token. Copy the token and the user id it shows: they're shown once.
2. **Paste the address, the user id and the token.** The address is the one you open Rocket.Chat at, like `https://chat.example.com`. Conch checks them with your server and connects. There is no Save button.
3. **Say hello.** In Rocket.Chat, start a direct message with the bot and send it anything. Then press **That's me** in Conch.

<!-- conch:channel-scene rocketchat key -->

## Your first hello

Once Conch knows it's you, the bot greets you by name.

<!-- conch:channel-scene rocketchat hello -->

## Good to know

- **No public address.** Conch connects to your server from this computer, over Rocket.Chat's own realtime connection, so your server only has to be reachable from here.
- **Answers keep their formatting**: Rocket.Chat writes Markdown, as Conch does.
- **Pictures and files.** A picture Conch makes, or a file it finishes, arrives as an upload in the chat, one to a message, the words with the first. A file over the server's **Maximum File Upload Size** (Administration → File Upload) can't go, and Conch says so.
- **Approvals** come with numbered answers: reply with the number.
- **In a channel**, add the bot to it. When someone mentions it, the channel shows on its page in Conch, off. Turn it on there, and it answers whoever mentions it: you as in private, everyone else in words only. See [In a group](index.md#in-a-group).
- **A token that stops working** stops this channel only. Make a new one for the bot and paste it.
