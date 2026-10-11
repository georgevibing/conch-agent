---
channel: wechat
---

## Which way in

A personal WeChat account has no official bot, and tools that log in as one break WeChat's terms and can get it banned. So Conch uses Tencent's own two ways in. 个人微信没有官方的机器人接口，所以 Conch 只用腾讯官方的方式。

- **A WeCom bot (企业微信机器人).** Recommended. Conch connects out to WeCom, with no public address. You chat in the free WeCom app, which signs in with WeChat.
- **An Official Account (公众号), or its free test account (测试号).** You chat in WeChat itself. It delivers to a web address, and its limits apply to answers that take a while.

## Connect a WeCom bot

1. **Make an AI bot (创建智能机器人).** No WeCom yet? Create a team (创建企业), for free. In WeCom's admin, make an **AI bot** (智能机器人) with **API mode** (API模式) and **long connection** (长连接).
2. **Paste its Bot ID and Secret.** Conch checks them.
3. **Say hello.** Send the bot "你好" in WeCom. Conch asks **Is this you?**. Press **That's me**.

<!-- conch:channel-scene wechat hello -->

## Connect an Official Account

1. **Get an account.** The test account is quickest: open its page and scan the code with WeChat to see its **appID** and **appsecret**. A real Official Account has them under **设置与开发 → 基本配置**.
2. **Paste the AppID and AppSecret.** If WeChat takes calls only from listed addresses (IP白名单), Conch says which to add.
3. **Give it an address WeChat can reach.** Press **Turn on with Tailscale**, or use an address of your own.
4. **Paste three things in WeChat (服务器配置).** Conch shows the **URL**, a **Token** and an **EncodingAESKey**.
   On the test account, press **修改** under **接口配置信息**. On a real account, open **设置与开发 → 基本配置 → 服务器配置**, press **修改配置** and choose **安全模式** (safe mode). Paste the three and press **提交** (Submit). The step ticks itself off when WeChat checks the address.
5. **Say hello.** Follow the account in WeChat, send it "你好", then press **That's me**.

<!-- conch:channel-scene wechat key -->

## Good to know

- **Answers that take a while.** WeChat waits five seconds. Later answers go as customer-service messages (客服消息), which verified and test accounts may send within 48 hours of your last message. An unverified account can't: Conch keeps the answer and says "Still working on it". Send "?" to see it.
- **WeChat needs the standard port.** If your phone's private address already uses it, use an address of your own.
- **Approvals** come as a card with buttons in WeCom, and as numbers to reply with in WeChat.
- **Pictures from Conch** arrive in an Official Account's chat (PNG, JPEG or GIF, up to 10 MB), within the 48 hours, from a verified or test account. Other files, and anything through a WeCom bot, stay in the chat in Conch, and your assistant says so.
- **WeChat signs and encrypts every message.** Conch checks each signature before it reads anything.
