---
channel: qq
---

## Connect it

Your assistant becomes a QQ bot of your own. Conch connects out to QQ's gateway, so nothing on your computer is opened to the internet. In Conch, open **Apps**, choose **Talk to me here**, then **QQ**.

1. **Make a bot.** Open QQ's quick bot page and sign in by scanning its code with QQ on your phone. Press **Create** (创建) and give it your assistant's name. It shows the bot's **AppID** and **AppSecret**. Any QQ account can make up to five.
2. **Paste its AppID and AppSecret.** Conch checks them with QQ straight away, and connects. A bot made on the full platform (q.qq.com) needs its events set to **WebSocket**, not Webhook, in its development settings.
3. **Add it in QQ.** On the bot's page, scan its code with QQ and add it. Adding it is your hello. Press **That's me** in Conch.

<!-- conch:channel-scene qq key -->

## Your first hello

Once Conch knows it's you, your assistant greets you by name.

<!-- conch:channel-scene qq hello -->

## Who can find it

- **Until you verify your identity** on q.qq.com (实名认证), only you can use the bot, plus up to 20 test accounts you add there.
- **After that**, choose who the bot is for in its settings, and others can find and add it. Even then, nobody gets an answer until you **Let them in**.

## Good to know

- **Answers read as Markdown.** When your assistant asks before doing something, the answers are buttons under the question where QQ shows them, and numbers to reply with either way. QQ opens custom buttons to bots by invitation, so yours may show only the numbers.
- **Messages can't change.** QQ doesn't let a bot edit what it sent, so what was decided comes as a new message.
- **Voice messages** come with QQ's own transcript, and your assistant answers what you said. One without a transcript is turned into words on your computer.
- **Pictures and files.** Send it photos and files. A picture your assistant makes comes back as a picture, and a file as a file in your private chat; a group takes pictures only.
- **Answers that take a while.** QQ lets a bot reply to a message for an hour in a private chat (a few replies each) and five minutes in a group. Later answers go as messages of the bot's own, which QQ limits to a few a minute.
- **In a group**, add the bot to the group. It shows on its page in Conch, off. Turn it on there, and it answers whoever @mentions it, in words only. QQ gives each person a different id in a group than in your private chat, so in a group your assistant treats everyone as a guest, you too. See [In a group](index.md#in-a-group).
- **What leaves your computer**: only calls to QQ's own servers (api.bot.qq.com), with your bot's own keys.
- **A reset AppSecret** stops this channel only. Copy the new one from the bot's page and paste it on the channel's page.
