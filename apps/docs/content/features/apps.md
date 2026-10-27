---
title: Apps
description: Connect Notion, Gmail, Slack and more from one gallery, talk to your assistant from the apps you chat in, and decide what it may do in each.
order: 4
---

Connect your apps, and your assistant looks things up and acts in them: find a Notion page, open a GitHub issue. Connect the ones you chat in, and you can talk to it from there. Gallery apps belong to Conch, so they work with every provider and every model that can use tools.

It's all on **Apps**, in the sidebar.

## One app, one card

Each app is one card, whatever it does: Slack for reading and for messaging your assistant, Gmail with the email address you write to, 1Password for sign-ins and Environments. The card's switch turns the whole app on or off. A card that needs you comes first, with one button such as **Sign in again** or **Say hello**, and the sidebar counts it.

The page, top to bottom:

1. **Connected**: the apps you have.
2. **Add another app** (**Connect your first app** at the start), by kind: **Talk to me here**, **Work**, **Files**, **Passwords**, **Design**, **Business**, **Developer**, **Home**, **Browser** and **Other**. **Passwords** holds the password managers Conch can read; its switch is the one on **Passwords**.
3. **Found in** and a provider's name: apps Conch found there ([below](#apps-a-provider-set-up-by-itself)).

Pick a kind or type in **Find an app** (searches include **From the community**). When nothing matches, press **Make … with Conch**. Conch lists only services its own sign-in works with; for the rest, try **Zapier** or **Add your own**.

## What it does

An app's page shows where you are (**Apps › Gmail**; **Apps** goes back). Talking to your assistant in an app has its page under it: **Apps › Slack ›** and the bot's name.

**What it does** has a switch per part, such as **Read & search**, **Draft**, **Send (asks first)** and **Talk to me here**, or **Set up** for a part not set up yet. Setting up one part offers the other: after Slack, **Talk to Conch in Slack too?**; after Gmail with an app password, **Talk to Conch by email too?**, reusing the password. Nothing is shared until you press it.

## What it found, as it is

Steps in Google Calendar, Gmail, Google Drive or Slack say so beside the app's logo (**Looked at your calendar**, **Read #design**), and the results look as the app shows them:

- **Google Calendar**: the days you asked about, Today first, each event with its time, calendar colour, a camera for a video call and the place. An empty day says **Free**.
- **Gmail**: sender, subject, first line and time, a dot for unread, a clip for attachments. **Reply** puts "Draft a reply to …" in the message box.
- **Google Drive**: each file's kind, owner and last change.
- **Slack**: the channel, then who said what and when. **More** opens a long message.

A row opens the app in a new tab. Six show; **Show all** has the rest. The step's arrow shows what your assistant read; apps connected by address show text.

## Talk to me here

**Talk to me here** lists the apps you can message your assistant from, from Slack and email to Telegram, WhatsApp, iMessage, SMS and Microsoft Teams, each with its own steps ([Talk to me here](../channels/index.md)).

## Connect one

1. Open **Apps** and pick an app.
2. Press its button. Most open their own sign-in page (**Continue with Notion**); a few take a token, with steps beside the field.
3. When it says connected, press **Done** or **Choose what it can do**.

You sign in on the app's page, so Conch never sees your password; what it keeps stays on this computer. Gmail, Google Calendar, Google Drive and Slack need a little more, below.

## Or connect from a chat

When an unconnected app would help, your assistant offers it under the reply, with why: "What's on my plate this week?" may offer Linear. Naming an app offers it too.

Press **Connect**: **Connected Linear · carrying on** appears, then the answer, with **Also try** ideas you can tap. On a phone, sign-in opens in the same tab and returns to the chat.

- **Not now** hides the card for this chat.
- **Don't suggest**, under **⋯**, stops offers for that app everywhere; **Settings → General → Chats → Suggest again** brings them back.
- Another message folds the offer away.

One offer per reply, never the same app twice in a chat, and none after the chat has read a web page or an email, or in a routine.

## When a model can only chat

Some models can't use tools: many small local models, a few at OpenRouter, some of your own servers. The model picker marks them **Chat only — can't use your apps**. Ask one about a connected app, and your message waits with a card: "Chat Lite can't use Linear".

- **Switch to** a model that can, the same provider's first: the chat moves and your message goes.
- **Answer without it** sends anyway. Conch asks once per model in a chat.
- **Connect a provider** shows when none of your models can use apps.

Conch still lists your apps' tools in such a model's instructions and reads requests from its reply, enough for simple steps. When a model gets a tool call almost right (a number as text, a missing quote), Conch reads what it meant, or tells the model what to fix.

## Decide what it may do

For each app:

- **Ask every time.** It asks before every action.
- **Ask before changes.** It looks things up on its own and asks before creating, sending, changing or deleting. Gallery apps start here.
- **Don't ask.** It acts without asking. Conch has you confirm it's you first, since what it reads could try to trick it.

**Each tool** sets every tool to **Allow**, **Ask** or **Off**; one you turned off says **You turned this off**, with **Turn on**. A calendar change, a new Doc and a Slack message offer only **Ask** or **Off**.

**Send an email** and **Save a draft** start at **Ask** and show you the exact email first; **Allow** skips that, with **Undo**. The email still shows first after the chat has read something from outside, or when several accounts could send and you didn't name one. When every Google account is read only, **Draft & send** (or **Change events**, or **Make files**) says so; its **Allow** opens **Google accounts**.

### Full trust and Auto

**Full trust** in a chat overrides every **Ask**, with every provider: drafts, emails, calendar changes and Slack messages go without asking. Tools set to **Off** stay off, and your app settings return when you leave it.

**Auto** does the same, except:

- A tool set to **Ask** still asks, and one that deletes asks unless it's **Allow** or the app is **Don't ask**.
- After the chat reads something from outside, a change goes ahead once [Auto's review](../reference/modes.md#the-review) sees nothing wrong (apps you made in Conch can make ordinary changes). Paying, sending to other people, deleting, sharing access, or sending a key or pages of text still asks ([Permission modes](../reference/modes.md#auto)).
- It asks when a chat's numbers look wrong: one message to a crowd, a run of deletes, a big payment ([what a chat does, watched](../reference/modes.md#what-a-chat-does-watched)).

In every mode, with someone else's words in the chat, what goes to other people shows first. If an app changes what a tool does, Conch stops allowing it by itself and tells you.

The switch at the top turns an app off; **Disconnect** forgets its sign-in. To remove Conch on the app's side, look for "connected apps" in its settings.

## When one stops working

Conch keeps sign-ins fresh. One that needs you moves to the top of **Connected** with its fix (**Sign in again**, **Paste a new token**), and a chat that needed it says so.

If renewal fails, Conch keeps your sign-in and retries. Open the app’s page for **What the app said**, including the HTTP status when available. **Try again** checks the connection now; **Sign in again** opens a fresh sign-in and looks up the service’s current sign-in addresses.

## The gallery

<!-- conch:apps -->

## 1Password

Two parts, each with its own switch:

- **Fill sign-ins from 1Password.** Your logins show in **Passwords**, read in place, and your assistant fills one in the browser when you say OK. Nothing is copied. Needs 1Password's command line plus the app or a service account token ([Passwords](./passwords.md#1password-on-a-computer-without-the-app)), set in **Settings**.
- **Manage Environments.** Your assistant sees your Environments and variable names and adds to them when you say yes, never reading secret values. **Set up** walks you through it.

## Something that isn't listed

Press **Add your own**. On **Describe it**, say what you want and press **Build it** ([Make an app](./make-apps.md)). Or:

- **From a link**: an app someone shared, from its GitHub page or a `.conchapp` file.
- **By address**: any app that speaks MCP, the open standard for assistant tools. Conch opens its sign-in if needed.
- **Run a program**: an MCP app that runs on this computer.

These last two start at **Ask every time**.

> [!WARNING]
> A program you add runs as you and can do anything you can. Only add programs from people you trust.

## Apps a provider set up by itself

When a provider has its own app (in its settings, a plugin or its account) that Conch can connect too, Conch brings it in for every model and notes it in **Settings → Health → Fixed on its own**. One with no sign-in goes to **Connected**; one that needs one waits under **Found in**, with **Sign in**, uncounted. Hover one and press **×** to leave it out.

Apps Conch can't connect stay with the provider, in **Settings → Providers → Set up inside a provider**. What you leave out or disconnect stays out until you press **Use with every model** there.

## Connect Slack

You make a small Slack app in your workspace once and paste one key.

1. In **Apps**, choose **Slack**. If you already talk to your assistant in Slack, press **Use it** to reuse that app.
2. Otherwise press **Make the app in Slack**. Slack opens filled in: pick your workspace, press **Next**, then **Create**.
3. Open **Install App**, press **Install to Workspace** (or **Reinstall**), then **Allow**.
4. Copy the **User OAuth Token** (it starts `xoxp-`) and paste it in Conch.

Your assistant can read channels and search. Sending always shows the exact words and channel and asks; you can turn it off, never let it go by itself. After reading Slack, anything that could send something out asks first. An older app can't read yet: **No User OAuth Token there?** has the settings for its **App Manifest** page. **Disconnect** forgets the key and asks Slack to forget it too.

To message your assistant in Slack, turn on **Talk to me here** and press **Set up**. It asks for the bot token and an app-level token from the same app ([Slack](../channels/slack.md)).

## Your Google accounts

Gmail, Google Calendar and Google Drive share one list of accounts, under **Google accounts** on each app's page. For each account and app, choose:

- **Off.**
- **Read.** Search and read mail, see events, find files.
- **Read & write.** Also drafts and email, adding, moving or deleting events, making a new Doc. Each change shows first (email can skip that with **Allow**).

Each account says how it's signed in (**App password · Gmail: read and send. Calendar and Drive need Google sign-in.** or **Google sign-in · Gmail, Calendar and Drive.**), whether it works, and what it may do.

- An app-password account offers **Switch to Google sign-in**; a Google sign-in offers **Use an app password instead**, for Gmail only.
- A sign-in Google only let read Gmail says **Read only: this sign-in can't send**.
- Where Google hasn't allowed enough yet, the row says **Read & write asks Google once**, and choosing it opens one Google sign-in.

**Check now** looks again. **Remove** forgets the account and, for Google sign-in, asks Google to revoke access; remove an app password on Google's app passwords page.

## Add a Google account

Press **Add an account** under **Google accounts**, or an app's tile.

1. **What should it help with?** Off, Read or Read & write for each app.
2. **How to connect.** An **app password** takes about two minutes and reaches Gmail only. **Google sign-in** reaches all three and needs your own free Google Cloud app once.
3. **Connect.** The steps for your choice. Google accounts belong to **Conch**, not your model provider.

### With an app password (Gmail only)

1. Type your Gmail address and press **Next**.
2. Press **Open Google’s app passwords page** (it needs [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification)). Name it “Conch” and press **Create**.
3. Paste the 16 letters into **App password**; Conch checks them.

If you already email your assistant from Gmail, Conch offers **Use it for Gmail**; turning on **Talk to me here** reuses it for `you+conch@gmail.com`, after asking. If Google stops taking it, the account says **Needs you** with a field for a new one, and Gmail shows **Sign in again**. Its access settings stay.

### One-time setup, with no hosted connection service

You need your own Google Cloud project and a **Desktop app** OAuth client. The same credential file works for a local Conch and a self-hosted server. No Conch cloud account, public callback or extra service.

1. Follow the setup guide to create or choose a project. An optional **Project ID** makes links open it.
2. Open each API linked for your job and press **Enable**.
3. In Google Auth Platform, complete **Branding**. In **Audience**, list every address you'll connect under **Test users**, one per line. Personal accounts use **External**; **Internal** is for eligible Workspace organizations.
4. Open **Clients**, press **Create client**, choose **Desktop app** and download the JSON. Drop it on **Drop the file you downloaded**, press **Choose the file**, or **Paste what’s in it instead**.
5. Press **Save and continue with Google**, choose your account and review its permissions.

Have the file? **I already have a credential file**. Credentials are encrypted on your Conch computer and never shared with your assistant or any service.

Coming back from Google:

- On a local address, it returns to Conch by itself.
- On a remote address, the page Google returns to may not load. Copy the **complete address from the address bar** into **Return address from Google** and press **Finish connecting**. Never paste it into chat.
- If Google opens another browser (Safari, from an installed iPhone Conch), it says **Almost done**: press **Finish connecting** in the Conch you started in.

An existing **Web application** client still works: under **Advanced: existing Web client**, copy the exact callback into its **Authorized redirect URIs**, then import its JSON or enter its ID and secret. Remote Web-client callbacks need HTTPS.

If a popup is blocked, press **Open Google sign-in**. A sign-in expires after ten minutes; Conch says what usually stops one after two. Signing in again refuses a different account, so nothing moves to another mailbox.

### If Google needs something changed

**If Google says no** links to the right settings:

- **API not enabled:** enable it, wait briefly, press **Check now**.
- **Test user missing or access blocked:** add the exact email under **Audience → Test users**. A Workspace admin may need to allow the app.
- **“400”, “malformed” or `redirect_uri_mismatch`:** start again from Conch, not an old Google tab. A Web client must list exactly the address Conch shows.
- **Unverified app:** confirm it's your own app before using Google's personal-testing option.
- **Access expires every week:** Testing mode can expire access after seven days. Leaving Testing may need Google verification; Conch doesn't publish your app.
- **Wrong file:** import a Desktop app OAuth JSON, not a service-account key.

### What read and write cover

**Read** searches and reads Gmail and Calendar events, and Drive file names and details, not contents.

**Read & write** adds, shown to you first:

- **Gmail:** save a draft or send an email or reply, with files from the chat up to about 18 MB. It sends from the account you name, otherwise the first that can, shown under **From**. Replies keep the thread, reply address and subject.
- **Gmail, tidying:** archive, label, mark read or unread, or move to the Trash, up to 500 emails at once; the card says how many. The Trash keeps them for 30 days and they can be put back. Nothing is deleted for good, and no settings change. Google sign-ins made before this asks Google once more: **Sign in again** on the account.
- **Gmail, unsubscribing:** leaves a mailing list the way its own email offers, in one click or with the email the list asks for, never by a link in the email's text. A list that only has a web page is named, for you or the browser.
- **Google Calendar:** add, change or delete an event, or accept, decline or say maybe to an invitation. Guests are emailed only when you say so; answering an invitation tells its organizer.
- **Google Drive:** make a new Google Doc or text file. Conch can only touch files it made.

**Before it goes**, the chat shows the email: from, to, subject, words and files.

- **Send** (<kbd>mod+enter</kbd>), **Don’t send**, or **Save as a draft instead**.
- **Edit** changes recipients, **Add Cc**, subject and words, or removes a file. **Done** keeps it, **Cancel** (<kbd>esc</kbd>) drops it. The card says **Edited by you**; **Undo my changes** restores it. Conch checks your version before it goes; if it can't be sent, nothing is. A reply keeps its thread's people and subject.
- Drafts, [task](./tasks.md) emails and emails set to **Allow** have no **Edit**.

**After it goes**, the card says:

- **Sent to …** or **Replied to …**, with **Show the email**, **Open in Gmail** and **Follow up**.
- **In your Drafts · not sent**, with **Open the draft in Gmail** and **Send it now**.
- **Gmail may have sent this**, with **Look in Sent**.
- That it didn't go, with **Try again**.

**Follow up**, **Send it now** and **Try again** only write a request in the message box; nothing goes until you send it.

If Google doesn't confirm a change, Conch looks for it rather than repeating it, and says plainly when it can't tell.

**Disconnect** keeps an account other Google apps still use; once none do, Conch revokes Google's access. If Google is offline, the entry stays so you can retry, or remove access in your Google account's third-party connections. **Repair everything** checks accounts and refreshes access when it safely can.

## Requested email in Auto

When you ask Conch to email you a generated file, Auto checks the resolved Gmail account, recipients and message against your request. Reading a web page along the way does not by itself require another approval. The same check runs with every provider. An unexplained recipient, an explicit Ask setting, a restricted workflow, or an unavailable risk check still asks before sending.
