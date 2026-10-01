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

Setting one up is a short numbered path in Conch, at **Channels**, beside a picture of exactly what you'll see in the other app. Keys are checked the moment you paste them, anywhere on the page.

## Nobody gets in unless you let them

- **You** say hello once, and Conch knows the bot is yours.
- **Anyone else** who writes gets one polite reply that names no one, and appears in Conch as a request. Press **Let them in** or **Block**.
- **Private chats only.** The bot ignores groups and servers, where anyone could speak for you.

## What works from a chat

- **Everything your assistant can do.** A message becomes a Conch chat with your default provider. It shows in the sidebar, wearing the app's logo.
- **Approvals, as buttons.** When your assistant asks, the question arrives with **Allow**, **Always in this chat** and **Don't allow**. Answer it anywhere, and the message updates to say what was decided.
- **Photos and files** you send become attachments.
- **Routine results**, and a routine's questions, come to you there when the channel has **Routine results** on.
- **Three commands:** `/new` starts a fresh conversation, `/stop` stops the answer, `/help` explains. Any other `/name` runs your skill of that name.

## It reconnects by itself

A dropped connection is retried, lightly at first and then every minute. An outage of more than a minute leaves a note under **Fixed on its own**. One channel failing never touches another.

Only one thing needs you: if the app stops accepting the key, that channel says so and asks you to **Paste the new key**.
