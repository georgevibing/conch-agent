---
channel: wechat
---

## Which way in

A personal WeChat account has no official way to be a bot. Tools that log in as a personal WeChat account go against WeChat's terms, and Tencent can ban accounts that use them. So Conch uses Tencent's own two ways in. 个人微信没有官方的机器人接口，所以 Conch 只用腾讯官方的方式。

- **A WeCom bot (企业微信机器人).** Recommended. Conch connects out to WeCom, so nothing on your computer is opened to the internet. You chat with it in the WeCom app, which is free and signs in with WeChat.
- **An Official Account (公众号), or its free test account (测试号).** You chat with it in WeChat itself. WeChat delivers its messages to a web address, and its limits apply to answers that take a while.

## Connect a WeCom bot

1. **Make an AI bot in WeCom (创建智能机器人).** No WeCom yet? Create a team of your own (创建企业); it's free. In WeCom's admin, make an **AI bot** (智能机器人), choose **API mode** (API模式) and **long connection** (长连接).
2. **Paste its Bot ID and Secret.** Conch checks them with WeCom straight away.
3. **Say hello.** Open the bot in WeCom and send it "你好". Conch asks **Is this you?** with your name. Press **That's me**.

<!-- conch:channel-scene wechat hello -->

## Connect an Official Account

1. **Get an account.** The quickest is WeChat's test account: open its page, scan the code with WeChat, and it shows an **appID** and **appsecret**. A real Official Account has them under **设置与开发** → **基本配置**.
2. **Paste the AppID and AppSecret.** If WeChat only takes calls from listed addresses (IP白名单), Conch says which address to add.
3. **Give it an address WeChat can reach.** Press **Turn on with Tailscale**, or use an address of your own.
4. **Paste three things in WeChat (服务器配置).** Conch shows the **URL**, a **Token** and an **EncodingAESKey** it made for you. Paste them, choose **安全模式** (safe mode) on a real account, and press **提交**. The step ticks itself off when WeChat checks the address.
5. **Say hello.** Follow the account in WeChat and send it "你好", then press **That's me**.

<!-- conch:channel-scene wechat key -->

## Good to know

- **Answers that take a while.** WeChat waits five seconds for an answer. Later ones go as customer-service messages (客服消息), which verified accounts and the test account may send within 48 hours of your last message. An account of your own that isn't verified can't: Conch keeps the answer and says "Still working on it". Send "?" to see it.
- **WeChat needs the standard port.** If your phone's private address already uses it, use an address of your own for WeChat.
- **Approvals** come as a card with buttons in WeCom, and as numbers to reply with in WeChat.
- **Pictures from Conch** (a picture it made) arrive in an Official Account's chat: PNG, JPEG or GIF, up to 10 MB, within WeChat's 48 hours and from a verified or test account. Other files, and anything through a WeCom bot, can't go; your assistant says so, and they're in the chat in Conch.
- **Messages are signed and encrypted** by WeChat. Conch checks every signature before it reads anything.
