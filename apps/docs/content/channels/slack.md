---
channel: slack
---

## Connect it

Slack makes the app from settings Conch fills in. Open **Apps → Talk to me here → Slack**.

1. **Make the Slack app.** Conch opens Slack with everything filled in. Pick your workspace, press **Next**, then **Create**.
2. **Install it and copy its key.** Open **Install App**, press **Install to Workspace**, then **Allow**. Copy the **Bot User OAuth Token** (`xoxb-…`).
3. **Let it stay connected.** Open **Basic Information → App-Level Tokens** and press **Generate Token and Scopes**. Name it "conch", add the scope `connections:write`, and press **Generate**. Copy the token (`xapp-…`).
4. **Say hello.** Send your app a direct message. Conch asks **Is this you?**. Press **That's me**.

Paste both keys anywhere on Conch's page, in either order. Conch tells them apart and checks them.

<!-- conch:channel-scene slack key -->

## Your first hello

<!-- conch:channel-scene slack hello -->

## Good to know

- **Two keys:** the first lets the app speak, the second lets Conch reach Slack with no public address.
- **Slack showed an empty form?** On the first step, open **Slack showed an empty form?** for the settings to paste.
- **Commands go after `/conch`**, since Slack keeps `/` for its own. Write `/conch model` or `/conch goal ship the notes`. `/conch` alone lists them. See [Slash commands](../reference/slash-commands.md#in-chat-apps).
- **While it works**, your message gets 👀.
- **Pictures and files** from Conch arrive as Slack files, under its words.
- **Channels:** invite the app (`/invite @yourapp`), mention it, then turn the channel on in Conch. See [In a group](index.md#in-a-group).
- **It can read Slack for you too.** Press **Set it up** on the channel's page, or **Set up** beside **Read & search** on Slack's, and paste the same app's **User OAuth Token**. See [Apps](../features/apps.md#connect-slack).
- **Already let it read Slack?** Turn on **Talk to me here** on Slack's page in Apps. Copy the bot token from **Install App**, and make the app-level token.

## An app made before October 2026

Add these in Slack:

- **The `/conch` command.** Open **App Manifest**, paste the manifest Conch shows on the first step, and press **Save**.
- **Pictures and files.** Add the `files:write` scope under **OAuth & Permissions**, then press **Reinstall to Workspace**.
- **Mentions in channels.** Add the `app_mentions:read` scope and the `app_mention` event, then press **Reinstall to Workspace**.
