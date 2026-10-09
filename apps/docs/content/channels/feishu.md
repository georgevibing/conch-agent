---
channel: feishu
---

## Connect it

Your assistant becomes a bot in Feishu (飞书) or Lark, as an app of your own. It's one card in Conch: choose **Feishu** if you use it in mainland China (feishu.cn), or **Lark** everywhere else (larksuite.com). In Conch, open **Apps**, choose **Talk to me here**, then **Feishu / Lark**.

1. **Scan the code with Feishu.** Conch shows a code. In Feishu on your phone, tap **+**, then **Scan**, and confirm. Feishu makes an app named for your assistant, with its bot, the permissions it needs and the events it listens for, and hands it to Conch. Whoever scans the code is its owner, so there's no hello to say.
2. **Turn on its long connection.** In the developer console, open the new app. Under **Events & Callbacks** (事件与回调), set **Event configuration** and **Callback configuration** to **Receive through persistent connection** (使用长连接接收), and save. Feishu accepts this only while Conch is connected, and it already is.
3. **Publish it.** In **Version Management & Release** (版本管理与发布), create a version and submit it. Your organisation's admin approves it; if that's you, approve it in the admin console.

Your assistant says hello in Feishu as soon as it's connected.

<!-- conch:channel-scene feishu key -->

## By hand

Press **Make the app by hand instead** under the code, or paste an App ID anywhere on the page.

1. **Make an app with a bot.** In the developer console, press **Create Custom App** (创建企业自建应用) and give it your assistant's name. Under **Features** (添加应用能力), add **Bot** (机器人).
2. **Paste its App ID and App Secret.** They're on the app's **Credentials & Basic Info** page (凭证与基础信息). Conch checks them with Feishu straight away, and connects.
3. **Let it hear messages.** In **Permissions & Scopes** (权限管理), press **Batch import** (批量导入) and paste the permissions Conch shows. Turn on the long connection as above, and add the events and the callback Conch lists.
4. **Publish it**, as above.
5. **Say hello.** Scan the code Conch shows with Feishu, or open its link: your chat with the bot opens, and it notices you're there. Press **That's me** in Conch.

## Your first hello

Once Conch knows it's you, your assistant greets you by name.

<!-- conch:channel-scene feishu hello -->

## Good to know

- **No public address.** Conch connects out to Feishu over its long connection (长连接), so nothing on your computer is opened to the internet, and there's no IP allowlist or domain to set up.
- **Answers read as Markdown**: headings, lists, links, tables and code. When your assistant asks before doing something, the question is a card with **Allow**, **Always in this chat** and **Don't allow**. Press one, and the card changes to say what was decided.
- **Pictures and files both ways.** Send it photos, files and voice messages; voice messages are turned into words on your computer. A picture your assistant makes comes back as a picture (up to 10 MB), anything else as a file (up to 30 MB).
- **In a group**, add the bot to the group. It shows on its page in Conch, off. Turn it on there, and it answers whoever @mentions it or replies to it: you as in private, everyone else in words only. Feishu only sends the bot messages that mention it. See [In a group](index.md#in-a-group).
- **Who can find it** is up to the version you published: only you, some people, or everyone in your organisation. Anyone else who writes gets one polite reply and waits for you to **Let them in**.
- **What leaves your computer**: only calls to Feishu's own servers (open.feishu.cn and accounts.feishu.cn, or open.larksuite.com and accounts.larksuite.com for Lark), with your app's own keys.
- **A reset App Secret** stops this channel only. Copy the new one from **Credentials & Basic Info** and paste it on the channel's page.
