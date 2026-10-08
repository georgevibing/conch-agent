---
channel: line
---

## Connect it

Your assistant gets a LINE Official Account of its own, and you add it as a friend. In Conch, open **Apps**, choose **Talk to me here**, then **LINE**.

1. **Make an Official Account.** In LINE Official Account Manager, make a new account (the free plan is fine). Then open **Settings → Messaging API** and press **Enable Messaging API**.
2. **Copy its secret and a token.** In the LINE Developers Console, open the account's channel. Copy the **Channel secret** from **Basic settings**, then press **Issue** under **Channel access token** on the **Messaging API** tab. Paste both on Conch's page: Conch checks them with LINE.
3. **Give it an address LINE can reach.** LINE delivers messages to a web address, so Conch opens one, with one press, and tells LINE to use it.
4. **Turn on Use webhook.** On the **Messaging API** tab, turn on **Use webhook**. In LINE Official Account Manager, under **Response settings**, turn off **Auto-response messages**, so only your assistant answers.
5. **Say hello.** Scan the code Conch shows with LINE (or open its link on your phone), add the account as a friend, and send it anything. Then press **That's me** in Conch.

<!-- conch:channel-scene line key -->

## Your first hello

Once Conch knows it's you, your assistant greets you by name.

<!-- conch:channel-scene line hello -->

## Good to know

- **Plain text.** LINE has no bold or headings, so answers come as plain words. When your assistant asks before doing something, the answers are buttons under the message.
- **Messages a month.** An answer within a minute of your message is free. Later ones count against the messages your plan allows each month; the free plan's are few. If they run out, the channel's page says so.
- **Every message is checked**: LINE signs what it delivers with the channel secret, and Conch reads nothing that isn't signed.
- **Pictures and files from Conch** can't go to LINE: LINE only takes them from a public web address, and Conch never puts your files on the internet. Your assistant says so, and they're in the chat in Conch.
- **In a group**, invite the account like a friend. It shows on its page in Conch, off. Turn it on there, and it answers whoever mentions it: you as in private, everyone else in words only. See [In a group](index.md#in-a-group).
- **A token that stops working** stops this channel only. Reissue it on the **Messaging API** tab and paste it.
