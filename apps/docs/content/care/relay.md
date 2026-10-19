---
title: The always-on relay
description: A tiny relay keeps texts, Teams messages and routine webhooks, locked for your computer alone, while Conch is off.
order: 4.5
---

Conch runs on your computer, so while the computer is off or asleep, nothing reaches it. Twilio and Teams don't send a message twice, and another app's webhook is lost. The always-on relay is a tiny program somewhere that's always on. It takes what arrives while Conch is off and keeps it for up to a week. It's locked so only your computer can read it, and it comes in when Conch is back.

## Set it up

1. Open **Settings → Health → Always on** and press **Set up a relay**. Conch makes a key that never leaves your computer.
2. Pick one place for the relay and copy its command:
   - **Cloudflare, free**: run it in the `apps/relay` folder of Conch's source. Nothing to keep running.
   - **A Raspberry Pi or a small server** with Node 22.18 or later. It starts again by itself.
   - **Docker**: Fly.io, Render or a NAS.
3. Paste the relay's address, starting `https://`, and press **Use this relay**.

From then on, every public address Conch gives your apps leads to the relay: Twilio's texts, Teams, LINE, Google Chat, WeChat, and the addresses of routines that start when another app sends a message. Conch points Twilio at it by itself.

The command holds a setup code, which isn't a secret. It only lets the relay lock messages for this computer.

## While Conch runs

Messages pass straight through the relay, and the app gets Conch's own answer. When Conch starts, it brings in what the relay kept, oldest first, and each one is checked as if it had just arrived: a message that isn't signed by its app is turned away.

## What it can see

Whoever runs the relay sees when messages arrive, how big they are and how many wait. It can't read what it keeps, or which app a message is for. It can't make up a message either, because each app's own signature is checked on your computer.

A routine address without a secret trusts whoever has the address, so give a routine a secret when it uses the relay.

## When it needs you

**Settings → Health** checks the relay with everything else: that it answers, that it locks messages for this computer, and how many wait. If it was set up for another computer, or with another key, it says so and you set it up again.

Press **Stop using it** to go back. Anything still at the relay can't be opened once the key is gone.

## Mail and the calendar

These don't need the relay. When Conch starts again, it looks back up to a week for mail that fits a routine. It reads the newest 20 and counts the rest in one line, and a backlog starts one run, within your [spending limits](./what-it-costs.md). A meeting that hasn't started yet still gets its run; one that's over doesn't.
