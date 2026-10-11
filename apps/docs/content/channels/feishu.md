---
channel: feishu
---

## Connect it

Your assistant becomes a bot in Feishu (飞书) or Lark, as an app of your own. Open **Apps → Talk to me here → Feishu / Lark**, and choose **Feishu** in mainland China (feishu.cn) or **Lark** everywhere else (larksuite.com).

1. **Scan the code with Feishu.** On your phone, tap **+**, then **Scan**, and confirm. Feishu makes the app, with its bot, permissions and events, and hands it to Conch. Whoever scans is its owner.
2. **Turn on its long connection.** In the developer console, open the new app. Under **Events & Callbacks** (事件与回调), set **Event configuration** and **Callback configuration** to **Receive through persistent connection** (使用长连接接收), and save. Feishu accepts this only while Conch is connected.
3. **Publish it.** In **Version Management & Release** (版本管理与发布), press **Create a version**, give it a number like 1.0.0, and press **Submit for release**. Your organisation's admin approves it, in the admin console if that's you.
4. **Say hello.** The scan already made you the owner, so Conch shows **You're connected** and your assistant greets you in Feishu. Press **Send a test message** to check.

<!-- conch:channel-scene feishu key -->

## By hand

Press **Make the app by hand instead** under the code, or paste an App ID anywhere on the page.

1. **Make an app with a bot.** In the developer console, press **Create Custom App** (创建企业自建应用) and name it after your assistant. Under **Features** (添加应用能力), add **Bot** (机器人).
2. **Paste its App ID and App Secret** from **Credentials & Basic Info** (凭证与基础信息).
3. **Let it hear messages.** In **Permissions & Scopes** (权限管理), press **Batch import** (批量导入) and paste the permissions Conch shows. Turn on the long connection as above, then add the events and callback Conch lists.
4. **Publish it**, as above.
5. **Say hello.** Scan the code Conch shows, or open its link, and press **That's me** in Conch.

## Your first hello

<!-- conch:channel-scene feishu hello -->

## Good to know

- **No public address**, IP allowlist or domain. Conch connects out over Feishu's long connection (长连接).
- **Answers read as Markdown**: headings, lists, links, tables and code.
- **Approvals are a card** with **Allow**, **Always in this chat** and **Don't allow**.
- **Pictures and files both ways.** Send photos, files and voice messages. Your assistant sends back pictures up to 10 MB and other files up to 30 MB.
- **In a group**, it answers @mentions and replies, the only messages Feishu sends it. See [In a group](index.md#in-a-group).
- **Who can find it** depends on the published version: you, some people, or your whole organisation. Anyone else gets one polite reply and waits for you to **Let them in** or **Block**.
- **What leaves your computer**: calls to open.feishu.cn and accounts.feishu.cn (open.larksuite.com and accounts.larksuite.com for Lark), with your app's keys.
- **A reset App Secret**: paste the new one on the channel's page.
