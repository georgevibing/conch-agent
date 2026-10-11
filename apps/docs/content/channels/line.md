---
channel: line
---

## Connect it

Your assistant gets a LINE Official Account, and you add it as a friend. Open **Apps → Talk to me here → LINE**.

1. **Make an Official Account.** In LINE Official Account Manager, make one (the free plan is fine). Open **Settings → Messaging API** and press **Enable Messaging API**.
2. **Copy its secret and a token.** In the LINE Developers Console, open the account's channel. Copy the **Channel secret** from **Basic settings**. On the **Messaging API** tab, press **Issue** under **Channel access token**. Paste both in Conch.
3. **Give it an address LINE can reach.** Press the button in Conch. Conch opens the address and tells LINE to use it.
4. **Turn on Use webhook.** On the **Messaging API** tab, turn on **Use webhook**. In LINE Official Account Manager, under **Response settings**, turn off **Auto-response messages**.
5. **Say hello.** Scan Conch's code with LINE (or open its link on your phone), add the account, and send it anything. Press **That's me**.

<!-- conch:channel-scene line key -->

## Your first hello

<!-- conch:channel-scene line hello -->

## Good to know

- **Plain text.** No bold or headings. Approvals come as buttons under the message.
- **Messages a month.** An answer within a minute of your message is free. Later ones count against your plan's monthly messages, and the free plan has few. The channel's page says when they run out.
- **Every message is checked.** Conch reads nothing LINE didn't sign with the channel secret.
- **Pictures and files from Conch** stay in the chat in Conch, and your assistant says so. LINE takes them only from a public web address.
- **Groups:** invite the account like a friend, then turn the group on in Conch. See [In a group](index.md#in-a-group).
- **Token stopped working?** Reissue it on the **Messaging API** tab and paste it.
