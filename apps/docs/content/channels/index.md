---
title: Talk to me here
description: Message your assistant from the chat apps on your phone, and approve what it asks right there.
nav: Overview
order: 1
---

<!-- conch:channels -->

In Conch, these are in **Apps**, under **Talk to me here**. An app you also let your assistant use, like Slack or Gmail, is one card with a switch for each: **Talk to me here** is one of them. See [Apps](../features/apps.md#one-app-one-card).

## A bot of your own

A channel is a bot you make in the chat app, connected to the Conch on your computer. There is no shared Conch bot, and no Conch server in between.

Conch connects **outward** to the app. Nothing on your computer is opened to the internet, and you need no public address and no tunnel.

Some apps only deliver to a web address: **Microsoft Teams**, **Google Chat**, a WeChat **Official Account**, **LINE**, and **SMS** through Twilio. For them, Conch can open one public address with one press (through Tailscale Funnel), or use an address of your own. It leads to a small door of its own, not to Conch: the door lets in only messages the app signed, for the channels you connected. A WeChat **WeCom bot**, **Matrix**, **Feishu / Lark**, **DingTalk** and **QQ** connect outward like the others.

Setting one up is a short numbered path in Conch, from **Apps → Talk to me here**, beside a picture of exactly what you'll see in the other app. Keys are checked the moment you paste them, anywhere on the page.

## Your own WhatsApp or Signal

WhatsApp and Signal have no bots to make. Instead Conch joins **your own account** as a linked device, like WhatsApp Web or Signal Desktop: you scan a code with your phone, and that is your hello. You talk to your assistant in the chat with yourself (**Message yourself**, **Note to Self**). Other people who write to you are writing to you: Conch never reads their chats, or your groups.

## iMessage and email

**iMessage and email** are different: they use an account that's already yours. iMessage answers through Messages on your Mac when you text yourself; email answers from your own address when you write to `you+conch@…`. There's no bot to make, and since the answer comes from you, other people's messages are never read unless you say so.

## Nobody gets in unless you let them

- **You** say hello once, and Conch knows the bot is yours.
- **Anyone else** who writes gets one polite reply that names no one (none at all on iMessage and email), and appears in Conch as a request. Press **Let them in** or **Block**.
- **Groups only when you turn them on.** A group the bot is in shows on its page in Conch, off. Until you turn it on there, the bot doesn't answer in it.

## In a group

Telegram, Discord, Slack, Google Chat, Mattermost, Rocket.Chat, LINE, Feishu / Lark, DingTalk and QQ can answer in a group, a server's channel or a team's channel, once you turn that group on in Conch. Add the bot to the group in the app; the group shows up on the bot's page in Conch under **Groups**, with a switch.

- **Only when it's asked.** In a group that's on, your assistant answers only when someone mentions it (`@yourbot`) or replies to one of its messages. Everything else in the group is never read.
- **You get everything.** When you mention it, it's the same assistant as in your private chat, in a conversation of its own for that group.
- **Everyone else gets words only.** Anyone else in the group who mentions it gets an answer, and nothing more: no files, no commands, no apps, nothing it remembers about you. Each person has a conversation of their own, so what one writes never reaches yours. Their questions run on your provider, at most 20 an hour per group.
- **Only you approve.** When something you asked for needs your OK, the question comes to your private chat with the bot, never to the group, where others could see or press it.
- **What others write is read as theirs.** If you reply to someone's message and mention your assistant, their words come along, read as someone else's, so anything they say can't make it act without asking you first.
- **It knows you by your account.** Someone who takes your name, or forwards your words, is still someone else.

Turn a group off, and your assistant goes quiet there at once. **Forget** takes it off the list until the bot hears from it again. WhatsApp, Signal, iMessage and email are your own account, so they never answer in groups. Teams, Matrix, WeChat and SMS answer in private chats only.

## What works from a chat

- **Everything your agents can do.** A message becomes a Conch chat with your default agent and provider. It shows in the sidebar, wearing the app's logo.
- **Any of your agents.** Send `/agent` to choose who answers you here, or `/agent atlas` to choose by name. Or choose in Conch, with **Answered by** on the chat app's page. See [Agents](../features/agents.md#in-chat-apps).
- **Approvals, as buttons.** When your assistant asks, the question arrives with **Allow**, **Always in this chat** and **Don't allow**. Answer it anywhere, and the message updates to say what was decided. WhatsApp, Signal, iMessage, email, SMS and DingTalk have no buttons, so you reply with the answer's number; QQ shows its buttons only to bots it invited, with the numbers always there. Where an app can't change a message (WeCom, DingTalk, QQ), what was decided comes as a new one.
- **Photos and files** you send become attachments.
- **Pictures and files back.** A picture your assistant makes, or a file it finishes, comes back in the chat with its answer: a photo on Telegram, an upload on Slack or Discord. In someone else's chat, only a picture made from words goes; an edit of one of your files, or a file of yours, only ever goes to you. Teams and a WeChat Official Account take pictures only; Google Chat, LINE, SMS and a WeCom bot can't carry files from Conch, so your assistant says so and the file waits in Conch. DingTalk takes pictures and PDF, Office, ZIP and RAR files only, and a QQ group pictures only.
- **Voice notes** are turned into words on your computer and answered like anything you typed. See [Voice](../features/voice.md#voice-notes-from-your-chat-apps).
- **Routine results**, and a routine's questions, come to you there when the channel has **Routine results** on.
- **Messages your assistant starts.** Ask in any chat, here or in Conch, "text me on WhatsApp when it's done" or "send the weather to my Telegram", and your assistant writes to you there. A [routine](../features/routines.md) can do the same. It only ever writes to your own private chat with Conch, never to anyone else. Without an app named, it uses the one you wrote from last. It can send pictures and files too ("send the picture to my Telegram"): only ones from that chat in Conch, never a file it names by its place on your computer.
- **Conch's commands, the same as in Conch.** `/clear` (with **Undo**), `/agent`, `/goal`, `/plan` (approved with **Start**), `/retry`, `/model`, `/effort`, `/fast`, `/mode`, `/status`, `/new`, `/stop` and `/help`, from the same list the web app uses, so they work with every provider. A mistyped one hears what you probably meant. `/name` runs your own command or skill of that name. See [Slash commands](../reference/slash-commands.md#in-chat-apps).

## Choose how Conch works here

Send `/settings` in your private chat. The menu shows the current provider, model,
effort, fast mode and permissions. Telegram and other apps with buttons let you
tap a choice; email, Signal, WhatsApp and other text-only apps show numbered
answers. `/model`, `/effort`, `/fast` and `/mode` go straight to those choices,
the one in use ticked. To find a model quickly, send `/model` followed by its
name or a few words. You can also write `/effort high`, `/fast on` or
`/mode read only`.

**This chat** changes the current conversation and saves your choices for fresh
conversations in this channel. **Defaults across Conch** changes the defaults
throughout Conch. Existing chats without their own choices follow those defaults
on their next turn. A model, effort or speed you pick for this chat is done at
once, and the reply says what changed. A change to the defaults, going back to
them, and a mode that lets your assistant do more without asking (**Auto**,
**Full trust**) say which scope they affect and ask you to save.
Choose a provider and model from the connected providers; only the effort and
speed controls that model supports are offered. If an answer is running, stop it
or wait before changing this chat.

The menu also controls routine notifications and voice replies in this channel,
automatic titles, learning and memory tidying, offline fallback, personality,
your name and About you, and turn limits. When Conch asks for text, the next
message fills that setting; `/cancel` leaves it without saving. Menus expire
after ten minutes. Open `/settings` again if a menu is old or Conch restarted.

Only the channel owner can use settings, in a private chat. Another person you
let in, a group member or a forwarded message cannot change them. Full trust
has its own warning before you save it.

**All other settings** opens Conch's existing settings pages when it has an
address. Sign in there as usual. Credentials, choosing files, device appearance
and controls that require a fresh sign-in stay there. Without an address, the
menu tells you where to find them on the computer running Conch.

## It reconnects by itself

A dropped connection is retried, lightly at first and then every minute. An outage of more than a minute leaves a note under **Settings → Health → Fixed on its own**. One channel failing never touches another.

Only one thing needs you: if the app stops accepting the key, that channel says so and asks you to **Paste the new key** (on Matrix, to **Sign in again**). A WhatsApp or Signal unlinked on your phone asks you to **Link again** instead. The public address that Microsoft Teams, Google Chat, WeChat, LINE and SMS use is checked from the outside now and then; if Tailscale forgot it, Conch turns it back on.
