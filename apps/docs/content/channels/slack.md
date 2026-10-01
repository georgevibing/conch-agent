---
channel: slack
---

## Connect it

In Conch, open **Channels** and choose **Slack**. Slack makes the app from settings Conch fills in; you press a few buttons and copy two keys.

1. **Make the Slack app.** Conch opens Slack with everything filled in. Pick your workspace, press **Next**, then **Create**.
2. **Install it, and copy its key.** In the app's settings, open **Install App** and press **Install to Workspace**, then **Allow**. Copy the **Bot User OAuth Token**. It starts with `xoxb-`.
3. **Let it stay connected.** Open **Basic Information**, scroll to **App-Level Tokens** and press **Generate Token and Scopes**. Name it "conch", add the scope `connections:write`, and press **Generate**. Copy the token. It starts with `xapp-`.
4. **Say hello.** Send your app a direct message. Conch asks **Is this you?** with your name and the message. Press **That's me**.

Paste each key anywhere on Conch's page, in either order. Conch sorts out which is which and checks both with Slack.

<!-- conch:channel-scene slack key -->

## Your first hello

Once Conch knows it's you, the app greets you by name.

<!-- conch:channel-scene slack hello -->

## Good to know

- **Why two keys.** The first lets the app speak. The second lets Conch reach Slack from your computer, with no public address.
- **Slack showed an empty form?** Conch has the settings ready to paste: on the first step, open **Slack showed an empty form?**
- **While it works** your message gets 👀. Slack has no "typing…" for apps.
- **It answers direct messages only.**
