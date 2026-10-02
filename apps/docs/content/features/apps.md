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

Gmail, Google Calendar and Google Drive connect directly to Conch after one-time Google app setup, described below. Slack may connect through your provider’s account; that connection works only with that provider’s models. Provider-owned connections are shown separately.

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

## Connect Google directly

Google accounts belong to **Conch**, not your model provider. In Integrations,
choose Google, Gmail or Google Calendar. Choose the personal or work account you
want; Conch shows its email address and the access actually granted. Reading
mail, saving drafts, reading calendar events and searching Drive have separate
permissions. Only the permissions needed for your job are requested.

The person running this Conch must register a Google Cloud **Web application**
OAuth client once. The setup card walks through enabling the relevant APIs,
configuring Google Auth Platform’s consent screen and test users, and copying
the exact callback address into Authorized redirect URIs. Paste the client ID
and secret into that card; do not send them to your assistant. They are encrypted
on the Conch computer. For a remote Conch, use its reachable HTTPS address, not
localhost on a different computer.

After setup, **Connect Google** opens Google’s own sign-in window. Your current
job stays open. Choose an account and review the access; when sign-in finishes,
Conch checks the connection. Allow popups for Conch if your browser blocks it.
Use **Reconnect** to restore revoked access or add permissions for a new job.
Use **Connect Google · another account** to add work and personal separately.
Changing accounts during a reconnect is refused so a job cannot silently move
to another mailbox.

Gmail supports search, reading and saving **drafts only**. Conch asks before
saving and verifies the saved content. Replies use the original message’s verified
thread, reply address and subject; sent-email followups go to the original recipients.
Mail is decoded into readable text with a source link that opens the correct account. It never sends messages. Google’s own
draft scope also includes sending; Conch explains this before consent, but does
not expose a send action. If Google does not confirm a save, Conch checks for the
existing draft rather than automatically creating a duplicate. Check the draft
in Gmail if the result remains uncertain.

Calendar is read-only. Drive currently searches files and reads their metadata
and description; it does **not** read document bodies or change files. The
Google APIs must be enabled in the registered project. Google Workspace admins
can restrict access. Public applications using Gmail or Drive scopes may require
Google verification; a testing app’s refresh tokens can expire after seven days.
Conch does not claim that a public OAuth application has been verified for you.

**Disconnect** revokes Google access before removing its local sign-in. If Google
is offline, Conch keeps the entry so you can retry deliberately; you can also
remove access in your Google account’s third-party connections. **Repair everything**
checks connected accounts and refreshes access when it safely can.
