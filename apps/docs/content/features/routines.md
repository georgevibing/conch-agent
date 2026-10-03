---
title: Routines
description: Have your assistant do something on a schedule, like a morning briefing, and read what it did when you're back.
order: 3
---

A routine is something your assistant does for you on a schedule: a morning briefing, a weekly review, a reminder at five. You describe it in plain words, the schedule reads in plain words, and nothing runs until you turn it on.

## Make one

Ask in any chat: "every weekday at 8, tell me what's on my calendar". Your assistant drafts the routine and shows it as a card, with its schedule written out.

- **Turn on** starts it.
- **Try it now** runs it once, so you can see the result first.
- **Edit** changes the words, the schedule, or what it may do.
- **Not now** keeps it, paused.

You can also open **Routines** in the sidebar and start a new one there. Describe what you want and press **Draft it**, pick one of the ideas, or choose **Set it up yourself**.

## When it runs

Under **Repeats**, choose **Once**, **Every day**, **Weekdays**, **Weekly**, **Monthly** or **Every few hours**. **Custom** is there for people who know cron. Conch writes the schedule back in words ("Every day at 9:00 AM") and lists the next runs, so you can check it before you save. The most often a routine can run is every 15 minutes.

Routines run while Conch is running. If Conch was off at the scheduled time, the routine runs once when Conch is back, never several times to make up. To skip a missed time instead, turn off **Catch up if Conch was off**.

With [Always on](../care/always-on.md), Conch keeps running with no window open, so routines run on time.

## What it may do while you're away

Nobody is watching when a routine runs, so each one says how far it may go without you:

- **Ask me first.** The run pauses and waits for your answer. Every routine drafted in a chat starts here.
- **Allow file changes.** It can create and edit files without asking. Commands still wait for you.
- **Allow everything.** It runs commands and changes anything, unasked. Only for tasks you fully trust.

Only you can turn a routine on or give it more room. If your assistant rewrites a routine's instruction, the routine pauses and goes back to **Ask me first** until you've read it and turned it on again.

## Read what it did

Open a routine to see its **History**: every run, with one line saying what happened. A run is a chat of its own, so you can open it, read each step, and reply to follow up.

- A run that is waiting for you, or didn't finish, puts its routine under **Needs you** at the top of the page.
- Turn on [notifications](../start/phone.md) and Conch tells you when a routine has run.
- A [channel](../channels/index.md) with **Routine results** on brings the result to your chat app.

**Run now** on the routine's page runs it straight away, whatever its schedule.

## What it costs

Each routine says what it costs, beside its schedule.

- **About $1.20 a month** with a provider you pay as you go, from what its runs cost and how often it runs. Before its first run it says **Roughly**, from a typical run on its model. If Conch doesn't know the model's price, it says nothing rather than guess.
- With a subscription, that it **runs on your plan**, and once it has run, how much of your plan's limit a run takes.
- **Free on this computer** with a model on this computer.

Each run in **History** shows what it cost, too.

**Edit** shows the **Model** a routine runs on, and lets you choose another. Something simple, like a reminder, can use a smaller, cheaper one. When your assistant drafts a simple routine, it may choose your provider's small model, never a bigger one.

## It won't run up a bill

Three things keep routines from spending your money or your plan while you're away. They're on from the start, with nothing to set.

- **A run that does far more than usual stops.** That's about three times what the routine usually costs (before it has run, three times a typical briefing on its model), and never less than $1. The run ends under **Needs you** with one line saying why. **Let it use more** lets that routine's runs go further. **Edit** sets an exact amount under **Most one run may spend**.
- **A monthly limit.** Routines that cost money may spend $20 a month until you change it. Every run counts, whatever started it, and so do the checks a routine makes before it runs. At the limit they pause until the 1st, and Conch tells you once: on the Routines page, in a notification, and in your chat apps. Choose **Raise the limit** or **Keep paused**. Routines on a plan, or on this computer, carry on.
- **Room for your own chats.** With a subscription, a routine doesn't start while any of your plan's limits is 80% used. Its run says **Waited so your own chats have room**, and goes by itself once the limit resets.

The monthly limit is in **Settings → Usage**, under **Routines**, or type "what routines may spend" in <kbd>mod+k</kbd>. Only you can change it, or how much one run may spend. Your assistant can't, whatever it reads.

## Good to know

- Each run starts fresh. It doesn't see the chat that created it, so the instruction should say everything it needs.
- At most two routines run at once. A run that would be a third, or that comes due while the routine's last run is still going, is skipped, and **History** says why.
- If the routine's provider isn't ready when a run is due (signed out, say), the run waits. It goes by itself once the provider is back, within 12 hours.
- Routines are plain files in `~/.conch/routines`, and part of every [backup](../care/backups.md).
