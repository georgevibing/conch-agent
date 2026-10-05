---
title: Apps
description: Connect Notion, Gmail, Slack and more from one gallery, talk to your assistant from the apps you chat in, and decide what it may do in each.
order: 4
---

Connect the apps you already use, and your assistant can look things up and act in them: find a page in Notion, open an issue in GitHub, catch up on Slack. Connect the ones you chat in, and you can talk to it from there too. Every app in the gallery belongs to Conch, so it works with every provider and every model that can use tools. There is no file to edit.

Everything is on one page, **Apps**, in the sidebar. It used to be two, Integrations and Channels; old links still lead here.

## One app, one card

Each app is one card, whatever it does for you. Slack is one card whether your assistant reads it for you, you message your assistant in it, or both. The same goes for Gmail and the email address you write to, and for 1Password, which fills sign-ins and manages Environments. The card's switch turns the whole app on or off.

A card that needs you comes first, with its one button, such as **Sign in again** or **Say hello**. The sidebar shows how many need you.

The page has three parts, top to bottom:

1. **Connected**: the apps you have.
2. **Add another app**: what Conch offers, by kind. The kinds are **Work**, **Talk to me here**, **Files**, **Passwords**, **Design**, **Business**, **Developer** and **Home**. **Passwords** has the password managers Conch can read: turn one on from its page here or from **Passwords**, it's the same switch. Pick a kind above the gallery to see only that one, or type a name in **Find an app**.
3. **Found in** and a provider's name: apps Conch came across there. See [Apps a provider set up by itself](#apps-a-provider-set-up-by-itself).

Type in **Find an app** to see apps people shared under **From the community**, or, when nothing matches, press **Make … with Conch**.

Every app in the gallery is one Conch can really connect: before an app goes in, Conch's own sign-in is tried against the service. A few well-known services only let apps they already know sign in, so they aren't offered. **Zapier** reaches many of those, and **Add your own** takes any other.

## What it does

An app's page starts with **What it does**: a plain switch for each thing, such as **Read & search**, **Draft**, **Send (asks first)** and **Talk to me here**. Turn off what you don't want. A part that isn't set up yet has a **Set up** button instead of a switch, so nothing looks on when it isn't.

Setting up one part offers the other when it can. After you connect Slack, the dialog asks **Talk to Conch in Slack too?**. After you connect Gmail with an app password, it asks **Talk to Conch by email too?**, and one press uses the same password. Nothing is shared until you press it.

## What it found, as it is

When your assistant looks in Google Calendar, Gmail, Google Drive or Slack, the step says so in plain words beside the app's logo, like **Looked at your calendar** or **Read #design**. What it found shows under that step, the way the app itself would show it:

- **Google Calendar**: the days you asked about, Today first. Each event has its time, a line in its calendar's colour, a camera for a video call and the place. A day with nothing on says **Free**, and today shows where now is.
- **Gmail**: who each email is from, the subject, its first line and when it came, with a dot for unread and a clip for attachments. **Reply** puts "Draft a reply to …" in the box you type in. Nothing is sent: you read it, change it and send it.
- **Google Drive**: each file with its kind, whose it is and when it changed.
- **Slack**: the channel, then who said what and when. A long message folds; **More** opens it.

Press a row to open it in the app, in a new tab. Six rows show at first, and **Show all** has the rest. Your assistant still reads its own answer from the app, behind the step's arrow. Apps you connect by address show their results as text.

## Talk to me here

**Talk to me here**, above the gallery, shows the apps you can message your assistant from: Slack, Gmail and email, Telegram, Discord, WhatsApp, Signal, iMessage, Microsoft Teams, Matrix and WeChat. Each has its own steps, beside a picture of what you'll see. See [Talk to me here](../channels/index.md).

## Connect one

1. Open **Apps** in the sidebar and pick an app.
2. Press its one button. Most apps open their own sign-in page (**Continue with Notion**). A few take a token instead, with the steps and a link to the right page beside the field.
3. When it says connected, press **Done**, or **Choose what it can do**.

You sign in on the app's own page, so Conch never sees your password. What it keeps stays on this computer, readable by you alone, and is never shown again.

Gmail, Google Calendar, Google Drive and Slack are apps like the others: press their tile. Gmail connects with an app password; Calendar and Drive need your own Google Cloud app, once. Slack connects with your own Slack app. All are described below.

## Or connect from a chat

When an app that isn't connected would answer what you asked, your assistant offers it under the reply. You don't have to name the app: ask "what's on my plate this week?" and it may offer Linear or Google Calendar, saying why in a sentence. Naming one ("what's assigned to me in Linear?") offers it too.

Press **Connect** and connect it right there. Once it's connected, the chat carries on by itself: a quiet line says **Connected Linear · carrying on**, and the answer follows. There's nothing to ask again. Under that answer, **Also try** shows a couple of things the app can do; a tap sends exactly those words.

On a phone, signing in opens the app's page in the same tab. When you're done it brings you back to the chat, which carries on the same way.

- **Not now** puts the card away for this chat.
- **Don't suggest**, under **⋯** on the card, stops the offers for that app everywhere. To get them back, open **Settings → Models** and press **Suggest again**.
- Send another message instead, and the offer folds to a small line. The chat won't carry on from it.

Only one offer shows under a reply, and the same app isn't offered twice in a chat. Your assistant never offers anything after the chat has read a web page or an email, or when nobody's there to press it, such as in a routine.

## When a model can only chat

Some models weren't made to use tools: many small models on this computer, a few at OpenRouter, some servers of your own. The model picker shows **Chat only — can't use your apps** under them.

Ask one of them about an app you connected, and your message waits with a card: "Chat Lite can't use Linear". Press **Switch to** and the model that can. The chat moves to that model, and your message goes by itself. Conch only offers models you've already set up, the same provider's first.

**Answer without it** sends your message to the model you chose anyway. Conch asks once per model in a chat. If none of your models can use apps, the card offers **Connect a provider**.

Even then, Conch doesn't leave the model without your apps. It lists their tools in the model's instructions and reads the model's requests from its reply, so many small models manage simple steps, like saving a memory or looking something up. A model made for tools is still more dependable. Only a model too small to read even a short list of tools answers without any, and the chat says so.

When a model asks for a tool almost right, Conch reads what it meant: a number written as text, a missing quote, a field the tool doesn't take. When it can't, it tells the model exactly what to fix, so it gets a second try.

## Decide what it may do

Choose how your assistant uses each app. Saving a Gmail draft always asks, whatever you choose, so it only offers **Ask** or **Off**:

- **Ask every time.** It asks before every action.
- **Ask before changes.** It looks things up on its own, and asks before it creates, sends, changes or deletes anything. Apps from the gallery start here.
- **Don't ask.** It acts without asking. Something it reads could try to trick it, so Conch asks you to confirm it's you first.

Under **Each tool**, every tool the app offers has its own **Allow**, **Ask** or **Off**, for when the switches under **What it does** aren't fine enough. Turn off what you don't need: your assistant stays more focused with fewer tools. Sending a Slack message, like saving a Gmail draft, only offers **Ask** or **Off**.

**Full trust** in a chat takes precedence over **Ask every time**, **Ask before changes** and a tool's **Ask** setting. Enabled app tools run without those questions, with every provider. Choosing Full trust also answers an ordinary app question already waiting. The saved app settings stay as they are and apply again when you leave Full trust. Tools turned **Off** stay off. Saving a Gmail draft, sending a Slack message and other mandatory confirmations still ask.

If an app later changes what one of its tools does, Conch stops allowing that tool by itself and tells you.

The switch at the top turns an app off and keeps its sign-in for later. **Disconnect** makes Conch forget the sign-in. To remove Conch on the app's side too, look for "connected apps" in that app's own settings.

## When one stops working

Conch checks your apps and keeps their sign-ins fresh. One that needs you moves to the top of **Connected** with the one button that fixes it, such as **Sign in again** or **Paste a new token**. The sidebar shows how many need you, and a chat that needed the app says so in place.

## The gallery

<!-- conch:apps -->

## 1Password

1Password is one app with two parts, each with its own switch on its page:

- **Fill sign-ins from 1Password.** Your 1Password logins show in **Passwords**, read where they are, and your assistant fills one in the browser when you say OK. Nothing is copied. It needs 1Password's command line on this computer; **Set up** shows how.
- **Manage Environments.** For developers: your assistant sees the names of your 1Password Environments and their variables, and adds to them when you say yes. It never reads the secret values. **Set up** walks you through turning it on in 1Password.

## Something that isn't listed

Press **Add your own**. It opens on **Describe it**: say what you want in your own words, press **Build it**, and Conch makes the app for you in a chat. See [Make an app](./make-apps.md).

The dialog's other tabs:

- **From a link** adds an app someone shared, from its GitHub page or a `.conchapp` file.
- **By address** connects any app that speaks MCP, the open standard assistants use for tools. Paste its address, and Conch opens its sign-in page if it needs one.
- **Run a program** connects an MCP app that runs on this computer.

What you add by address or as a program starts at **Ask every time**.

> [!WARNING]
> A program you add runs as you and can do anything you can. Only add programs from people you trust.

## Apps a provider set up by itself

A provider can have apps of its own: set up in its settings, brought by a plugin, or connected in its account. When Conch can connect the same app itself, it brings it in on its own, so it works with every model. **Health → Fixed on its own** notes each one.

One that needs no sign-in goes straight to **Connected**. One you have to sign in to waits in its own section, **Found in** and the provider's name, at the bottom of the page, below the gallery. It says once where the apps came from, and each has one button: **Sign in**. They aren't problems, so the sidebar doesn't count them. Hover one and press **×** to leave it out of Conch.

Conch only offers what it can really connect. Some services let only apps they already know sign in, and a provider's plugin is one of those. Conch can't sign in to these by itself, so it leaves them with the provider.

What Conch can't connect (a program in the provider's settings, a plugin, a service that takes no new apps) only works with that provider. It's in **Settings → Providers → Set up inside a provider**, folded away. Something you leave out or disconnect stays out; to bring it back, press **Use with every model** there.

## Connect Slack

Slack belongs to Conch too, so every model can read and send in it. You make a small Slack app in your own workspace, once, and paste one key.

1. In **Apps**, choose **Slack**. If you already talk to your assistant in Slack, Conch offers to use the same app: press **Use it**.
2. Otherwise press **Make the app in Slack**. Slack opens with everything filled in: pick your workspace, press **Next**, then **Create**.
3. Open **Install App**, press **Install to Workspace** (or **Reinstall**), then **Allow**.
4. Copy the **User OAuth Token**. It starts with `xoxp-`. Paste it in Conch, and it's connected.

Your assistant can then see the channels you're in, search, and catch up on a channel. Sending a message always shows you the exact words and the channel, and asks; you can turn sending off, but never let it go by itself. What it reads in Slack is other people's words, so after reading, anything that could send something out asks first.

An app made before Slack worked this way can't read for you yet. The dialog says so, and **No User OAuth Token there?** has the settings to paste on the app's **App Manifest** page. **Disconnect** makes Conch forget the key and asks Slack to forget it too.

To message your assistant in Slack as well, turn on **Talk to me here** on Slack's page and press **Set up**. It uses the same Slack app, but needs two more keys from it, the bot token and an app-level token: they're separate from the one that reads as you, so Conch asks for them on purpose. See [Slack](../channels/slack.md).

## Connect Gmail with an app password

The simple way, for Gmail only. It takes about two minutes.

1. In **Apps**, press **Gmail**. Type your Gmail address and press **Next**.
2. Press **Open Google’s app passwords page**. Google only offers app passwords once [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) is on; its page says how. Name the password “Conch” and press **Create**.
3. Paste the 16 letters into **App password**. Conch checks them by signing in to Gmail as they land, and says so if Google refuses them.

If you already talk to your assistant by email from Gmail, Conch asks whether Gmail may use the same app password: press **Use it for Gmail**. The other way round, turning on **Talk to me here** on Gmail's page uses Gmail's app password for writing to `you+conch@gmail.com`. It's never shared without asking.

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
