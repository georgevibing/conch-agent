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

## Good to know

- Each run starts fresh. It doesn't see the chat that created it, so the instruction should say everything it needs.
- At most two routines run at once. A run that would be a third, or that comes due while the routine's last run is still going, is skipped, and **History** says why.
- If the routine's provider isn't ready when a run is due (signed out, say), the run waits. It goes by itself once the provider is back, within 12 hours.
- Routines are plain files in `~/.conch/routines`, and part of every [backup](../care/backups.md).
