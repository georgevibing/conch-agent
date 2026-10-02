---
title: Apps
description: Connect Notion, GitHub, Gmail and more from a gallery, and decide what your assistant may do in each.
order: 4
---

Connect the apps you already use, and your assistant can look things up and act in them: find a page in Notion, open an issue in GitHub, check your calendar. Apps connected to Conch work across providers with models that support tools. Connections owned by a provider stay with that provider. There is no file to edit.

In Conch, the page is called **Integrations**.

## Connect one

1. Open **Integrations** in the sidebar and pick an app.
2. Press its one button. Most apps open their own sign-in page (**Continue with Notion**). A few take a token instead, with the steps and a link to the right page beside the field.
3. When it says connected, press **Done**, or **Choose what it can do**.

You sign in on the app's own page, so Conch never sees your password. What it keeps stays on this computer, readable by you alone, and is never shown again.

Gmail, Google Calendar and Google Drive are apps like the others: press their tile. Gmail connects with an app password; Calendar and Drive need your own Google Cloud app, once. Both are described below. Slack may connect through your provider’s account; that connection works only with that provider’s models. Provider-owned connections are shown separately.

## Or connect from a chat

Ask about an app that isn't connected ("what's assigned to me in Linear?") and a small card appears under the reply, with one button: **Connect Linear**. Connect it right there, then press **Ask again** to send your question once more.

**Not now** puts the card away. **Don't suggest Linear** stops the offers for that app. To get them back, open **Settings → Models** and press **Suggest again**.

## When a model can only chat

Some models can't use apps, files or memory. They can only chat. The model picker shows **Chat only — can't use your apps** under them.

Ask one of them about an app you connected, and your message waits with a card: "Chat Lite can't use Linear". Press **Switch to** and the model that can. The chat moves to that model, and your message goes by itself. Conch only offers models you've already set up, the same provider's first.

**Answer without it** sends your message to the model you chose anyway. Conch asks once per model in a chat. If none of your models can use apps, the card offers **Connect a provider**.

## Decide what it may do

Choose how your assistant uses each app. Saving a Gmail draft always asks, whatever you choose, so it only offers **Ask** or **Off**:

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

## Connect Gmail with an app password

The simple way, for Gmail only. It takes about two minutes.

1. In **Integrations**, press **Gmail**. Type your Gmail address and press **Next**.
2. Press **Open Google’s app passwords page**. Google only offers app passwords once [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) is on; its page says how. Name the password “Conch” and press **Create**.
3. Paste the 16 letters into **App password**. Conch checks them by signing in to Gmail as they land, and says so if Google refuses them.

If your email channel already signs in to Gmail, Conch asks whether Gmail may use the same app password: press **Use it for Gmail**. It's never shared without asking.

With an app password, your assistant can search Gmail, read emails and save drafts in your **Drafts** folder. It can't send: Conch only reads mail and adds drafts (IMAP), and asks you before every draft. Google Calendar and Google Drive can't use an app password; they need the Google Cloud way below.

If Google stops taking the password (you removed it, or changed your Google password), Gmail moves to the top of **Connected** with **Sign in again**. Its page has the field to paste a new one. **Disconnect** forgets the password; to stop it working at Google too, remove it on Google’s app passwords page.

## Connect with your own Google Cloud app

The way for Google Calendar and Google Drive, and the advanced way for Gmail (press **Use your own Google Cloud app instead (advanced)** in its dialog). One Google account can serve all three apps; each asks Google only for what it needs, and a later one adds its permission to the same account.

Google accounts belong to **Conch**, not your model provider. Choose the personal
or work account you want; Conch shows its email address and the access actually
granted. Reconnecting an account keeps its existing access and requests the
additional permissions.

### One-time setup, with no hosted connection service

You need your own Google Cloud project and a **Desktop app** OAuth client.
The same credential file works for a local Conch and a self-hosted server.
There is no Conch cloud account, public callback address, or extra service to run.

1. Follow the setup guide to create or choose a Google Cloud project. An optional **Project ID** makes subsequent links open the right project.
2. Open each API linked for your job and press **Enable**. You do not need to enable unrelated Google apps.
3. Open **Branding** in Google Auth Platform and complete the app details. In **Audience**, add your email under **Test users** while the app is in Testing. Personal Google accounts use **External**; **Internal** is for eligible Workspace organizations.
4. Open **Clients**, press **Create client**, choose **Desktop app**, and download the JSON. Choose that file under **Google credential JSON**, or paste its contents into **Or paste credential JSON**. Conch checks the file before you save it.
5. Press **Save and connect Google**. Choose your account on Google’s own sign-in page and review its permissions.

Already have the file? Press **I already have a credential file**. No need to
copy individual IDs or secrets. Credentials are encrypted on your Conch
computer, never shared with your assistant or a Conch connection service.
Keep the downloaded file private.

On a local HTTP loopback address, Google returns to Conch automatically. On a
remote address, it returns to a local address that your browser may refuse to
open. That is expected. Copy the **complete address from the address bar**, paste
it into **Return address from Google** in Conch, and press **Finish connecting**.
Never paste it into chat. You do not need a terminal, port forwarding, or a public
Google callback. Keep using the same browser and Conch address throughout sign-in.

An existing **Web application** client still works. Under **Advanced: existing Web
client**, copy the exact callback into that client's **Authorized redirect URIs**.
You can import its JSON after registering that address, or enter its ID and
secret there. Remote Web-client callbacks require HTTPS. Desktop clients do not
need a registered callback.

Your current job stays open. If a popup is blocked, press **Open Google sign-in**.
Reloading Conch resumes the pending flow in the same tab. A sign-in expires after
ten minutes; if Conch restarts, start a new sign-in without repeating app setup.
Conch checks the account and actual API access before continuing your job.
Use **Reconnect** to restore revoked access or add permissions for a new job.
Use **Connect Google · another account** to add work and personal separately.
Changing accounts during a reconnect is refused so a job cannot silently move
to another mailbox.

### If Google needs something changed

Open **Sign-in help** for links to the correct project settings:

- **API not enabled:** enable the named API, wait briefly, then press **Check connection**. Conch keeps your sign-in and does not ask you to grant access again unnecessarily.
- **Test user missing or access blocked:** add the exact Google email under **Audience → Test users**. Workspace administrators may need to allow the app.
- **Unverified app:** check that it is your own app in your own project before using Google's available personal-testing option. A policy block may need an administrator, not another sign-in attempt.
- **Access expires every week:** Google Testing mode can expire refresh tokens after seven days. Review **Audience** before leaving Testing; sensitive access or public distribution may require verification. Conch does not publish your app for you.
- **Wrong file or callback:** import a current Desktop app OAuth JSON, not a service-account key. Web clients must contain the callback displayed by this Conch installation.

### What Google access allows

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

**Disconnect** on one app keeps a Google account the other Google apps still use.
When no app uses it any more, Conch revokes Google access before removing its local sign-in. If Google
is offline, Conch keeps the entry so you can retry deliberately; you can also
remove access in your Google account’s third-party connections. **Repair everything**
checks connected accounts and refreshes access when it safely can.
