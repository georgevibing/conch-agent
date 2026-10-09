---
channel: dingtalk
---

## Connect it

Your assistant becomes a robot in your DingTalk (钉钉) organisation. Conch connects out to DingTalk in Stream mode, so nothing on your computer is opened to the internet. In Conch, open **Apps**, choose **Talk to me here**, then **DingTalk**.

1. **Make an app with a robot.** In the DingTalk developer console, press **Create App** (创建应用) and give it your assistant's name. Under **Add capability** (添加应用能力), add a **Robot** (机器人). Set its **Message receiving mode** (消息接收模式) to **Stream mode** (Stream模式), and publish the robot.
2. **Paste its Client ID and Client Secret.** They're on the app's **Credentials & Basic Info** page (凭证与基础信息); the Client ID is also called the AppKey. Conch checks them with DingTalk straight away, and connects.
3. **Turn on its permission, and publish.** In **Permissions** (权限管理), apply for **企业内机器人发送消息权限**, which lets it answer you and fetch what you send it. Then in **Version Management & Release** (版本管理与发布), create a version, choose who can see it (at least yourself), and publish.
4. **Say hello.** In DingTalk, search for the robot by its name, open a chat with it and send it anything, like "你好". Press **That's me** in Conch.

<!-- conch:channel-scene dingtalk key -->

## Your first hello

Once Conch knows it's you, your assistant greets you by name.

<!-- conch:channel-scene dingtalk hello -->

## Good to know

- **Approvals are numbers.** DingTalk's buttons that call back need a card template made in its card platform, so when your assistant asks before doing something, you reply with the answer's number. It then says what was decided.
- **Voice messages** come with DingTalk's own transcript, and your assistant answers what you said. One without a transcript is turned into words on your computer.
- **Pictures and files.** Send it photos, files and videos. A picture your assistant makes comes back as a picture, and a PDF, Word, Excel, ZIP or RAR file as a file, up to 20 MB. DingTalk takes no other kinds of file from a robot; your assistant says so, and they're in the chat in Conch.
- **Messages a month.** DingTalk counts robot messages for the whole organisation: 5,000 a month on the free plan. If they run out, the channel's page says so, and it starts again next month.
- **In a group**, add the robot to the group. It shows on its page in Conch, off. Turn it on there, and it answers whoever @mentions it: you as in private, everyone else in words only. DingTalk only sends the robot messages that mention it. See [In a group](index.md#in-a-group).
- **What leaves your computer**: only calls to DingTalk's own servers (api.dingtalk.com and oapi.dingtalk.com), with your app's own keys.
- **A changed Client Secret** stops this channel only. Copy the new one from **Credentials & Basic Info** and paste it on the channel's page.
