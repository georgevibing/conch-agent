---
title: Check-ins and standing orders
nav: Check-ins
description: Say once what you want to hear about, or what your assistant may do, and Conch tells you only when something comes up, with why.
order: 3.5
---

A standing order is something you say once, in your own words, for every chat: "Always tell me if a flight changes", "Tell me when my parcel is out for delivery", "You may archive newsletters". Conch keeps it in mind from then on.

The check-in is what makes the "tell me" ones work. Every half hour, Conch looks at what's new in your email and the next two hours of your calendar. When something fits one of your standing orders, it tells you on your phone and in your [chat apps](../channels/index.md), and says why. Otherwise it says nothing.

## Add one

Open **Routines** in the sidebar. Under **Check-ins and standing orders**, type what you want the way you'd say it to a person, and press **Add**.

As you type, a label says how Conch reads it:

- **Tell me**: something you want to hear about. The check-in watches for it.
- **You may**: something you're happy for your assistant to do, like archiving newsletters.

You can also just say it in a chat: "from now on, always tell me if a flight changes". Your assistant offers it as a card, **Keep this as a standing order?**, with your words. Press **Keep it**, or **Not now**. Nothing is kept until you press.

To change one, press the pencil beside it. To stop one, press **×**. In <kbd>mod+k</kbd>, type "standing orders".

## What you hear

A notification from a check-in says what came in, what changed in a few words, and **why you're hearing this**: the standing order it was about, in your words.

On the Routines page, **Told you** lists the recent ones. **Why?** opens each to the standing order behind it, and **Open** goes to the email or the event.

- Each thing is told once.
- At most twelve notifications a day. On a busy day the rest are listed under **Told you**, without a sound.
- Notifications come under **Routines** in your notification settings, the same switch as your routines' results.

## Quiet hours

There are no check-ins between 10 PM and 7 AM. To change that, press **Quiet 10:00 PM – 7:00 AM** on the card and pick other times. The first look after quiet hours covers the night, so email that came while you slept still counts.

**Look now** looks straight away, whatever the time. The switch on the card turns check-ins off; turned back on, they start from then.

## What it costs

Looking is free: Conch searches your email and reads your calendar itself, without a model. Only when something new is there does it ask the cheapest model you have whether one of your standing orders covers it. That's a few cents a month at most, counted with your [routines](routines.md#what-it-costs) and held by the same monthly limit. On a plan, or with a model on this computer, it costs nothing.

With no "tell me" standing orders, the check-in doesn't look at all.

## What a standing order can't do

A standing order says what you want and what you welcome. It never gives permission. Whatever an order says, anything your [permission mode](../reference/modes.md) asks about still asks first. "You may send emails without asking" doesn't change that, and Conch says so beside it.

The check-in itself only reads and tells. It never replies, archives or deletes, even for a "you may" order. Those apply when your assistant is working in a chat or a routine, with that chat's permissions.

Email is written by other people, and some of it tries to steer assistants. What the check-in reads is handled as information, never as instructions. An email can't add a standing order, choose where a notification sends you, or put a link in one: the link always goes to the email itself.

## Good to know

- Check-ins need [Gmail or Google Calendar](apps.md). Without either, the card says so, with **Open Apps**.
- Like routines, check-ins only happen while Conch is running. With [Always on](../care/always-on.md), it keeps running with no window open.
- Standing orders are kept in `~/.conch/standing-orders.json`, and part of every [backup](../care/backups.md). Your assistant can't change that file.
- **Repair everything** in **Settings → Health** checks whether the check-in can look, and says what to do when only you can fix it.
