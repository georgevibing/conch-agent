---
channel: googlechat
---

## Connect it

You need a Google Workspace account, from a school or company. A personal Gmail can't make Chat apps. Open **Apps → Talk to me here → Google Chat**.

1. **Turn on the Google Chat API.** In Google Cloud, make or choose a project and press **Enable** on the Google Chat API.
2. **Give Conch a service account's key.** In **IAM & Admin → Service accounts**, press **Create service account** (no roles needed), then **Keys → Add key → Create new key → JSON**. Choose the downloaded file on Conch's page, or paste its contents.
3. **Open a public address.** Google Chat delivers to a web address. Conch opens one with one press.
4. **Make the Chat app.** On the Google Chat API's **Configuration** page:
   - Name it, and tick **Receive 1:1 messages** and **Join spaces and group conversations**.
   - Choose **HTTP endpoint URL**, paste the address Conch shows, and choose **HTTP endpoint URL** as the authentication audience.
   - Leave **Build this Chat app as a Workspace add-on** off.
   - Make it visible to yourself, and press **Save**.
5. **Say hello.** In Google Chat, press **New chat**, find the app, send it anything, and press **That's me** in Conch.

<!-- conch:channel-scene googlechat key -->

## Your first hello

<!-- conch:channel-scene googlechat hello -->

## Good to know

- **Every message is checked.** Conch reads only what Google signed for this channel's address.
- **The key stays here.** Only the short-lived tokens Google trades it for go to Google Chat.
- **Approvals**: reply with the answer's number. Conch reads your reply from Google Chat itself, so only you can answer.
- **Files** you send aren't taken yet.
- **Pictures and files from Conch** can't go to Google Chat, which lets only people upload. They wait in the chat in Conch.
- **In a space**, it answers mentions once you turn it on. See [In a group](index.md#in-a-group).
- **A key deleted in Google Cloud** stops this channel only. Add a new key and paste it.
