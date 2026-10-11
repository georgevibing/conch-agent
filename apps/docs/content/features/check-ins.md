---
title: Check-ins and standing orders
nav: Check-ins
description: Say once what you want to hear about, or what your assistant may do. Conch tells you only when something comes up, and why.
order: 3.5
---

A standing order is something you say once, for every chat: "Always tell me if a flight changes", "You may archive newsletters".

The check-in makes the "tell me" ones work. Every half hour, Conch looks at new email and the next two hours of your calendar. When something fits, it tells you on your phone and in your [chat apps](../channels/index.md), and says why.

## Add one

1. Open **Routines** in the sidebar.
2. Under **Check-ins and standing orders**, type what you want in your own words.
3. Press **Add**.

A label shows how Conch reads it:

- **Tell me**: something the check-in watches for.
- **You may**: something your assistant may do.

Or say it in a chat: "from now on, always tell me if a flight changes". A card, **Keep this as a standing order?**, offers **Keep it** or **Not now**; nothing is kept until you press. It also waits on the Routines page, marked **Suggested in a chat**.

You can keep up to 20. The pencil changes one; **×** stops it. In <kbd>mod+k</kbd>, type "standing orders".

## What you hear

A notification says what came in, what changed, and **why you're hearing this**: the standing order behind it.

On the Routines page, **Told you** lists recent ones, with **Why?** and **Open** (the email or event).

- Each thing is told once.
- At most twelve notifications a day. The rest are listed under **Told you**, without a sound.
- They use the **Routines** switch in your notification settings.

## Quiet hours

No check-ins between 10 PM and 7 AM. Press **Quiet 10:00 PM – 7:00 AM** on the card to pick other times. The first look after covers the night.

**Look now** looks at once, whatever the time. The switch on the card turns check-ins off; turned back on, they start from then.

## What it costs

Looking uses no model. Only something new goes to your cheapest model: a few cents a month at most, counted under your [routines'](routines.md#what-it-costs) monthly limit. On a plan, or with a model on this computer, it's free.

With no "tell me" orders, the check-in doesn't look.

## What a standing order can't do

- **Give permission.** Anything your [permission mode](../reference/modes.md) asks about still asks. "You may send emails without asking" doesn't change that, and Conch says so beside it.
- **Make the check-in act.** It only reads and tells, never replies, archives or deletes. "You may" orders apply when your assistant works in a chat or routine, with that chat's permissions.
- **Be added by an email.** What the check-in reads is information, never instructions. An email can't add a standing order, choose where a notification sends you, or put a link in one; the link always goes to the email itself.

## Good to know

- Check-ins need [Gmail or Google Calendar](apps.md). Without either, the card says so, with **Open Apps**.
- They happen only while Conch is running. With [Always on](../care/always-on.md), it runs with no window open.
- Standing orders live in `~/.conch/standing-orders.json`, part of every [backup](../care/backups.md). Your assistant can't change that file.
- **Repair everything** in **Settings → Health** checks whether the check-in can look, and says what to do when only you can fix it.
