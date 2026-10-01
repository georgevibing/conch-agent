---
title: Apps
description: Connect Notion, GitHub, Gmail and more from a gallery, and decide what your assistant may do in each.
order: 4
---

Connect the apps you already use, and your assistant can look things up and act in them: find a page in Notion, open an issue in GitHub, check your calendar. You connect an app once and it works with every model you pick. There is no file to edit.

In Conch, the page is called **Integrations**.

## Connect one

1. Open **Integrations** in the sidebar and pick an app.
2. Press its one button. Most apps open their own sign-in page (**Continue with Notion**). A few take a token instead, with the steps and a link to the right page beside the field.
3. When it says connected, press **Done**, or **Choose what it can do**.

You sign in on the app's own page, so Conch never sees your password. What it keeps stays on this computer, readable by you alone, and is never shown again.

Gmail, Google Calendar, Google Drive and Slack only let approved apps sign in. They connect through your provider's account, and Conch shows the steps. An app connected that way works only with that provider's models. To use it with every model, connect it through Zapier.

## Or connect from a chat

Ask about an app that isn't connected ("what's assigned to me in Linear?") and a small card appears under the reply, with one button: **Connect Linear**. Connect it right there, then press **Ask again** to send your question once more.

**Not now** puts the card away. **Don't suggest Linear** stops the offers for that app. To get them back, open **Settings → Models** and press **Suggest again**.

## Decide what it may do

Open a connected app and choose how your assistant uses it:

- **Ask every time.** It asks before every action.
- **Ask before changes.** It looks things up on its own, and asks before it creates, sends, changes or deletes anything. Apps from the gallery start here.
- **Don't ask.** It acts without asking. Something it reads could try to trick it, so Conch asks you to confirm it's you first.

Under **What it can do**, every tool the app offers has its own **Allow**, **Ask** or **Off**. Turn off what you don't need: your assistant stays more focused with fewer tools.

If an app later changes what one of its tools does, Conch stops allowing that tool by itself and tells you.

The switch at the top turns an app off and keeps its sign-in for later. **Disconnect** makes Conch forget the sign-in. To remove Conch on the app's side too, look for "connected apps" in that app's own settings.

## When one stops working

Conch checks your apps and keeps their sign-ins fresh. One that needs you moves to the top of **Connected** with the one button that fixes it, such as **Sign in again** or **Paste a new token**. The sidebar shows how many need you, and a chat that needed the app says so in place.

## The gallery

<!-- conch:apps -->

## Something that isn't listed

**Add your own** connects any app that speaks MCP, the open standard assistants use for tools. Paste its address, and Conch opens its sign-in page if it needs one. For one that runs on this computer, choose **Run a program**. What you add yourself starts at **Ask every time**.

> [!WARNING]
> A program you add runs as you and can do anything you can. Only add programs from people you trust.

Apps a provider set up by itself are listed under **From your providers**, and only work with that provider. Where Conch can connect the same app, **Use with every model** brings it in.
