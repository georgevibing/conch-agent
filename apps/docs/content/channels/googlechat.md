---
channel: googlechat
---

## Connect it

You need a Google Workspace account, the kind a school or a company gives you: a personal Gmail can't make Chat apps. In Conch, open **Apps**, choose **Talk to me here**, then **Google Chat**.

1. **Turn on the Google Chat API.** In Google Cloud, make a project (or choose one) and press **Enable** on the Google Chat API.
2. **Give Conch a service account's key.** In **IAM & Admin → Service accounts**, make one (it needs no roles), then **Keys → Add key → Create new key → JSON**. Choose the file it downloads on Conch's page, or paste what's in it. Conch checks it with Google.
3. **Give it an address Google Chat can reach.** Google Chat delivers messages to a web address, so Conch opens one, with one press.
4. **Make the Chat app.** On the Google Chat API's **Configuration** page, give it a name, tick **Receive 1:1 messages** and **Join spaces and group conversations**, choose **HTTP endpoint URL** and paste the address Conch shows, with **HTTP endpoint URL** as the authentication audience. Make it visible to yourself and press **Save**.
5. **Say hello.** In Google Chat, press **New chat**, find the app by its name, and send it anything. Then press **That's me** in Conch.

<!-- conch:channel-scene googlechat key -->

## Your first hello

Once Conch knows it's you, the app greets you by name.

<!-- conch:channel-scene googlechat hello -->

## Good to know

- **Every message is checked**: Google signs what it delivers, for this channel's own address, and Conch reads nothing else.
- **The key stays here.** Conch uses the service account's key to answer as the app, and sends it nowhere: only the short-lived tokens Google trades it for go to Google Chat.
- **Approvals** come as a card with buttons, which say what was decided once you press one.
- **Files** you send in Google Chat aren't taken yet.
- **In a space**, add the app. When someone mentions it, the space shows on its page in Conch, off. Turn it on there, and it answers whoever mentions it: you as in private, everyone else in words only. See [In a group](index.md#in-a-group).
- **A key that stops working** (deleted in Google Cloud) stops this channel only. Add a new key and paste it.
