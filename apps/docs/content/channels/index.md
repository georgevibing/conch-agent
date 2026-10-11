---
title: Talk to me here
description: Message your assistant from the chat apps on your phone, and approve what it asks right there.
nav: Overview
order: 1
---

<!-- conch:channels -->

These are in **Apps → Talk to me here**. An app your assistant can also use, like Slack or Gmail, is one card with a switch for each. See [Apps](../features/apps.md#one-app-one-card).

Not on the list? [Add any chat app](any-chat-app.md): name it, and Conch makes it.

## A bot of your own

A channel is a bot you make in the chat app, connected to Conch on your computer. There is no shared Conch bot and no Conch server in between.

Conch connects **outward** to the app. Nothing on your computer is opened to the internet, so you need no public address or tunnel.

A few apps only deliver to a web address: **Microsoft Teams**, **Google Chat**, a WeChat **Official Account**, **LINE**, and **SMS** through Twilio. For them, Conch opens one public address with one press (through Tailscale Funnel), or uses one of yours. It leads to a small door that lets in only messages the app signed, for the channels you connected.

Each channel's page is a few numbered steps. Keys are checked as you paste them.

## Your own WhatsApp or Signal

WhatsApp and Signal have no bots, so Conch joins **your own account** as a linked device, like WhatsApp Web. Scan a code with your phone, and that is your hello.

You talk in the chat with yourself (**Message yourself**, **Note to Self**). Conch never reads other people's chats with you, or your groups.

## iMessage and email

These use an account that's already yours, so there's no bot to make.

- **iMessage** answers through Messages on your Mac when you text yourself.
- **Email** answers from your own address when you write to `you+conch@…`.

Other people's messages are never read unless you say so.

## Nobody gets in unless you let them

- **You** say hello once, and Conch knows the bot is yours.
- **Anyone else** gets one polite reply that names no one (none on iMessage and email) and waits for you to **Let them in** or **Block**.
- **Groups stay off** until you turn them on, on the bot's page in Conch.

## In a group

Telegram, Discord, Slack, Google Chat, Mattermost, Rocket.Chat, LINE, Feishu / Lark, DingTalk and QQ can answer in a group or channel.

1. Add the bot to the group in the app.
2. In Conch, turn the group on under **Groups** on the bot's page.

How it behaves there:

- **Only when asked.** It answers a mention (`@yourbot`) or a reply to its message. Nothing else is read.
- **You get everything.** It's your same assistant, in a conversation of its own for that group.
- **Everyone else gets words only.** No files, commands, apps or memories of you. Each person has their own conversation. Their questions run on your provider, at most 20 an hour per group.
- **Only you approve.** Questions come to your private chat with the bot, never to the group.
- **Others' words stay theirs.** Quote someone and mention your assistant, and their words come along, marked as someone else's. They can't make it act without asking you.
- **It knows you by your account.** Someone who takes your name, or forwards your words, is still someone else.

Turn a group off, and it goes quiet at once. **Forget** hides it until the bot hears from it again.

WhatsApp, Signal, iMessage and email never answer in groups. Teams, Matrix, WeChat and SMS answer in private chats only.

## What works from a chat

- **Everything your agents can do.** A message becomes a Conch chat in the sidebar, with the app's logo.
- **Any of your agents.** Send `/agent`, or `/agent atlas` by name, or use **Answered by** on the chat app's page. See [Agents](../features/agents.md#in-chat-apps).
- **Approvals, as buttons**: **Allow**, **Always in this chat** and **Don't allow**. Answer anywhere, and the message updates.
  - WhatsApp, Signal, iMessage, email, SMS and DingTalk have no buttons: reply with the answer's number.
  - QQ shows buttons only to bots it invited, with numbers always there.
  - WeCom, DingTalk and QQ can't change a message, so the decision comes as a new one.
- **Photos and files** you send become attachments.
- **Pictures and files back**, with the answer: a photo on Telegram, an upload on Slack or Discord.
  - In someone else's chat, only a picture made from words goes. Your files only ever go to you.
  - Teams, a WeChat Official Account and a QQ group take pictures only.
  - DingTalk takes pictures and PDF, Word, Excel, ZIP and RAR files.
  - Google Chat, LINE, SMS and a WeCom bot can't carry files from Conch. Your assistant says so, and the file waits in Conch.
- **Voice notes** become words on your computer. See [Voice](../features/voice.md#voice-notes-from-your-chat-apps).
- **Routine results** and a routine's questions come there when the channel has **Routine results** on.
- **Messages your assistant starts.** Ask "text me on WhatsApp when it's done", and it writes to you there. A [routine](../features/routines.md) can too.
  - It only writes to your own private chat with Conch.
  - With no app named, it uses the one you wrote from last.
  - It sends pictures and files from that chat in Conch, never a file named by its place on your computer.
- **Conch's commands**: `/new`, `/clear` (with **Undo**), `/compact`, `/retry`, `/stop`, `/goal`, `/plan` (approved with **Start**), `/agent`, `/model`, `/effort`, `/fast`, `/mode`, `/status`, `/settings` and `/help`. They work with every provider, and a mistyped one gets what you probably meant. `/name` runs your own command or skill. See [Slash commands](../reference/slash-commands.md#in-chat-apps).

## Choose how Conch works here

Send `/settings` in your private chat. It shows the provider, model, effort, fast mode and permissions. Tap a choice, or reply with its number in text-only apps like email, Signal and WhatsApp.

- `/model`, `/effort`, `/fast` and `/mode` go straight to those choices.
- Shortcuts: `/model` and a few words of a name, `/effort high`, `/fast on`, `/mode read only`.
- **This chat** changes the current conversation and new ones in this channel.
- **Defaults across Conch** changes the defaults everywhere, from each chat's next turn.

A change for this chat applies at once. A change to the defaults, or a mode that asks less (**Auto**, **Full trust**), asks you to save first. You see only your connected providers and what the model supports. Stop or wait for a running answer before changing this chat.

The menu also covers:

- **This channel**: routine notifications and voice replies.
- **Preferences**: automatic titles, learning, memory tidying, a local model offline, the menu bar, keeping the computer awake, and turn limits.
- **Personality and about you**: your assistant's name, tone and instructions, your name and About you.
- **All other settings**: links to Conch's settings pages, when Conch has an address. Keys, files, how a device looks and fresh sign-ins stay there.

When Conch asks for text, your next message fills it. `/cancel` leaves without saving. Menus expire after ten minutes or a restart: send `/settings` again.

Only you, the owner, can use settings, and only in your private chat.

## It reconnects by itself

A dropped connection is retried, often at first, then every minute. An outage over a minute leaves a note under **Settings → Health → Fixed on its own**. One channel failing never touches another.

Only two things need you:

- **The app stops accepting the key**: press **Paste the new key** (on Matrix, **Sign in again**).
- **WhatsApp or Signal was unlinked on your phone**: press **Link again**.

Conch also checks the public address now and then, and turns Tailscale back on if it forgot.
