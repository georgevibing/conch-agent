---
channel: qq
---

## Connect it

Your assistant becomes a QQ bot of your own. Open **Apps → Talk to me here → QQ**.

1. **Make a bot.** Open QQ's quick bot page and sign in by scanning its code with QQ. Press **Create** (创建) and give it your assistant's name. Copy its **AppID** and **AppSecret**. Any QQ account can make up to five.
2. **Paste the AppID and AppSecret.** Conch checks them and connects. A bot made on the full platform (q.qq.com) needs its events set to **WebSocket**, not Webhook, in its development settings.
3. **Add it in QQ.** Scan the code on the bot's page with QQ and add it. That's your hello. Press **That's me** in Conch.

<!-- conch:channel-scene qq key -->

## Your first hello

<!-- conch:channel-scene qq hello -->

## Who can find it

- **Until you verify your identity** on q.qq.com (实名认证), only you and up to 20 test accounts you add there can use the bot.
- **After that**, choose who it's for in its settings, and others can add it. Nobody gets an answer until you **Let them in**.

## Good to know

- **Answers read as Markdown.** Approvals come as numbers to reply with, and as buttons where QQ shows them. QQ opens custom buttons to bots by invitation, so yours may show only the numbers.
- **Messages can't change.** What was decided comes as a new message.
- **Voice messages** come with QQ's own transcript. One without is turned into words on your computer.
- **Pictures and files.** Send it photos and files. Pictures come back as pictures. Files come back in your private chat only.
- **Answers that take a while.** A bot can reply to a message for an hour in a private chat (a few replies each) and five minutes in a group. Later answers go as the bot's own messages, a few a minute.
- **Groups:** add the bot, then turn the group on in Conch. It answers @mentions, in words only. QQ gives you a different id in a group, so there it treats everyone as a guest, you too. See [In a group](index.md#in-a-group).
- **Only QQ's servers** (api.bot.qq.com) hear from Conch, with your bot's own keys.
- **AppSecret reset?** Copy the new one from the bot's page and paste it on the channel's page.
