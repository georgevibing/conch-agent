---
channel: dingtalk
---

## Connect it

Your assistant becomes a robot in your DingTalk (钉钉) organisation, connected out in Stream mode. Open **Apps → Talk to me here → DingTalk**.

1. **Make an app with a robot.** In the DingTalk developer console, press **Create App** (创建应用) and name it after your assistant. Under **Add capability** (添加应用能力), add a **Robot** (机器人), set **Message receiving mode** (消息接收模式) to **Stream mode** (Stream模式), and publish the robot.
2. **Paste its Client ID (AppKey) and Client Secret** from **Credentials & Basic Info** (凭证与基础信息).
3. **Turn on its permission, and publish.** In **Permissions** (权限管理), find **企业内机器人发送消息权限** and press **Apply** (申请权限). In **Version Management & Release** (版本管理与发布), create a version, make it visible to at least yourself, and press **Publish**.
4. **Say hello.** Search DingTalk for the robot, send it anything, like "你好", and press **That's me** in Conch.

<!-- conch:channel-scene dingtalk key -->

## Your first hello

<!-- conch:channel-scene dingtalk hello -->

## Good to know

- **Approvals are numbers.** DingTalk buttons need a card template, so reply with the answer's number.
- **Voice messages** use DingTalk's transcript, or are turned into words on your computer.
- **Pictures and files.** Send photos, files and videos. Your assistant sends back pictures and PDF, Word, Excel, ZIP or RAR files up to 20 MB. Anything else stays in the chat in Conch.
- **5,000 robot messages a month** on the free plan, for the whole organisation. The channel's page says when they run out, and they start again next month.
- **In a group**, it answers only @mentions, the only messages DingTalk sends it. See [In a group](index.md#in-a-group).
- **What leaves your computer**: calls to api.dingtalk.com and oapi.dingtalk.com, with your app's keys.
- **A changed Client Secret**: paste the new one on the channel's page.
