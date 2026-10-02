---
title: Channels
description: Message your assistant from the chat apps on your phone, and approve what it asks right there.
nav: Overview
order: 1
---

<!-- conch:channels -->

## A bot of your own

A channel is a bot you make in the chat app, connected to the Conch on your computer. There is no shared Conch bot, and no Conch server in between.

Conch connects **outward** to the app. Nothing on your computer is opened to the internet, and you need no public address and no tunnel.

Two apps only deliver to a web address: **Microsoft Teams**, and a WeChat **Official Account**. For them, Conch can open one public address with one press (through Tailscale Funnel), or use an address of your own. It leads to a small door of its own, not to Conch: the door lets in only messages the app signed, for the channels you connected. A WeChat **WeCom bot** and **Matrix** connect outward like the others.

Setting one up is a short numbered path in Conch, at **Channels**, beside a picture of exactly what you'll see in the other app. Keys are checked the moment you paste them, anywhere on the page.

## Your own WhatsApp or Signal

WhatsApp and Signal have no bots to make. Instead Conch joins **your own account** as a linked device, like WhatsApp Web or Signal Desktop: you scan a code with your phone, and that is your hello. You talk to your assistant in the chat with yourself (**Message yourself**, **Note to Self**). Other people who write to you are writing to you: Conch never reads their chats, or your groups.

## iMessage and email

**iMessage and email** are different: they use an account that's already yours. iMessage answers through Messages on your Mac when you text yourself; email answers from your own address when you write to `you+conch@…`. There's no bot to make, and since the answer comes from you, other people's messages are never read unless you say so.

## Nobody gets in unless you let them

- **You** say hello once, and Conch knows the bot is yours.
- **Anyone else** who writes gets one polite reply that names no one (none at all on iMessage and email), and appears in Conch as a request. Press **Let them in** or **Block**.
- **Private chats only.** The bot ignores groups and servers, where anyone could speak for you.

## What works from a chat

- **Everything your assistant can do.** A message becomes a Conch chat with your default provider. It shows in the sidebar, wearing the app's logo.
- **Approvals, as buttons.** When your assistant asks, the question arrives with **Allow**, **Always in this chat** and **Don't allow**. Answer it anywhere, and the message updates to say what was decided. WhatsApp, Signal, iMessage and email have no buttons, so you reply with the answer's number.
- **Photos and files** you send become attachments.
- **Routine results**, and a routine's questions, come to you there when the channel has **Routine results** on.
- **Three commands:** `/new` starts a fresh conversation, `/stop` stops the answer, `/help` explains. Any other `/name` runs your skill of that name.

## It reconnects by itself

A dropped connection is retried, lightly at first and then every minute. An outage of more than a minute leaves a note under **Fixed on its own**. One channel failing never touches another.

Only one thing needs you: if the app stops accepting the key, that channel says so and asks you to **Paste the new key** (on Matrix, to **Sign in again**). A WhatsApp or Signal unlinked on your phone asks you to **Link again** instead. The public address Teams and WeChat use is checked from the outside now and then; if Tailscale forgot it, Conch turns it back on.
