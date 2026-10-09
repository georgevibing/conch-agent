---
title: Routines
description: Have your assistant do something at a time, like a morning briefing, or when something happens, like an email from someone you're waiting on.
order: 3
---

A routine is something your assistant does for you without being asked each time. It starts in one of two ways:

- **Every…** at a time: a morning briefing, a weekly review, a reminder at five.
- **When…** something happens: an email from Anna, a meeting about to start, a page that changed, a task that finished.

You describe it in plain words, Conch writes back when it starts in plain words, and nothing runs until you turn it on.

## Make one

Ask in any chat: "every weekday at 8, tell me what's on my calendar", or "tell me when Anna replies". Your assistant drafts the routine and shows it as a card that says when it starts.

- **Turn on** starts it.
- **Try it now** runs it once, so you can see the result first. A routine that starts when something happens tries itself on the most recent thing that fits, like Anna's last email.
- **Edit** changes the words, when it starts, or what it may do.
- **Not now** keeps it, paused.

A routine drafted in a chat runs as that chat's [agent](./agents.md), on its provider and model, so a routine you ask Atlas for in a chat with Codex runs as Atlas, with Codex. Its results come in that agent's voice. One made on the Routines page is done by your default agent. In **Edit**, **Answered by** chooses another agent, or **Default agent** for whichever is your default when it runs, and **Model** the provider and model. A routine with an agent of its own shows its face on its card, and its page says who does it under its name.

A run can do what a chat can: use your [apps](apps.md), the ones you added yourself too, your Conch apps and the browser. It can also write to you in any [chat app](../channels/index.md) you've connected: "every morning, send the weather to my Telegram" sends the message itself, to your own private chat with Conch.

You can also open **Routines** in the sidebar and start a new one there. Describe what you want and press **Draft it**, pick one of the ideas, or choose **Set it up yourself**. In <kbd>mod+k</kbd>, **New routine that starts when…** opens it with **When…** chosen.

## Every…

Under **Repeats**, choose **Once**, **Every day**, **Weekdays**, **Weekly**, **Monthly** or **Every few hours**. **Custom** is there for people who know cron. Conch writes the schedule back in words ("Every day at 9:00 AM") and lists the next runs, so you can check it before you save. The most often a routine can run is every 15 minutes.

If Conch was off at the scheduled time, the routine runs once when Conch is back, never several times to make up. To skip a missed time instead, turn off **Catch up if Conch was off**.

## When…

Under **Starts**, choose **When…**, then what starts it:

- **An email arrives.** From people you pick from those you write to, or about some words. Needs [Gmail](apps.md).
- **Before a meeting.** Some minutes before each event in your calendar, or only meetings with other people. Needs Google Calendar.
- **A page changes.** Conch reads the page every hour, or as often as you choose, and compares its words. Menus, times, dates and ads that come and go don't count.
- **A folder changes.** Choose it with **Choose a folder…**. Conch waits until the changes settle and ignores its own.
- **A task finishes.** One of your [background tasks](tasks.md) is done.
- **Another routine runs.** Right after it's done, like "after the morning briefing".

Under **Advanced**, **Another app sends a message** gives the routine its own web address, for a shop, a form or a service like GitHub. It needs the [public address](../channels/index.md) on. Copy the address from the routine's page, and press **Add a secret** to make sure only your app can use it. The secret is shown once.

**Only if…** narrows it down: "only if it's about the invoice". A small model reads each one first, for a fraction of a cent, and only wakes your assistant when it fits. If it can't tell, the routine runs anyway and says so.

A routine like this costs nothing while nothing happens: Conch looks without asking a model. The card says **Free until something happens**. When something does, the run sees what it was, and its line in **History** links to it. Many things at once become one run, and a routine runs at most four times an hour; anything more goes in its next run.

New email and meetings from while Conch was off still count when it's back. Changes to a folder while it was off don't.

After you connect Gmail or Google Calendar in **Apps**, Conch offers the routine that fits best, once. Nothing is made until you turn it on.

## What it may do while you're away

Nobody is watching when a routine runs, so each one says how far it may go without you:

- **Ask me first.** The run pauses and waits for your answer. Every routine drafted in a chat starts here.
- **Auto.** It gets on with it, and pauses to ask only before risky steps. New routines you make start here.
- **Allow everything.** It runs commands and changes anything, unasked. Only for tasks you fully trust.

What starts a **When…** routine was written by someone else, so its run is wary from the start: anything that could send things out or change your computer asks you first, whatever you chose.

Only you can turn a routine on or give it more room. If your assistant rewrites a routine's instruction, or what starts it, the routine pauses and goes back to **Ask me first** until you've read it and turned it on again.

## Read what it did

Open a routine to see its **History**: every run, with one line saying what happened. A run is a chat of its own, so you can open it, read each step, and reply to follow up. The page says **Routines ›** and the routine's name at the top: press **Routines** to go back to them all.

- A run that is waiting for you, or didn't finish, puts its routine under **Needs you** at the top of the page. So does a **When…** routine that can't look, like when Gmail needs you to sign in again.
- Turn on [notifications](../start/phone.md) and Conch tells you when a routine has run. A run with nothing to say stays quiet.
- A [channel](../channels/index.md) with **Routine results** on brings the result to your chat app.

**Run now** (or **Try it now**) on the routine's page runs it straight away.

## What it costs

Each routine says what it costs, beside its schedule.

- **About $1.20 a month** with a provider you pay as you go, from what its runs cost and how often it runs. Before its first run it says **Roughly**, from a typical run on its model. If Conch doesn't know the model's price, it says nothing rather than guess.
- With a subscription, that it **runs on your plan**, and once it has run, how much of your plan's limit a run takes.
- **Free on this computer** with a model on this computer.
- A routine that starts **When…** something happens says **Free until something happens**, and what one run costs: **About $0.04 a run**. Its **Only if…** checks count toward the monthly limit too.

Each run in **History** shows what it cost, too.

**Edit** shows the **Model** a routine runs on, and lets you choose another. Something simple, like a reminder, can use a smaller, cheaper one. When your assistant drafts a simple routine, it may choose your provider's small model, never a bigger one.

## It won't run up a bill

Three things keep routines from spending your money or your plan while you're away. They're on from the start, with nothing to set.

- **A run that does far more than usual stops.** That's about three times what the routine usually costs (before it has run, three times a typical briefing on its model), and never less than $1. The run ends under **Needs you** with one line saying why. **Let it use more** lets that routine's runs go further. **Edit** sets an exact amount under **Most one run may spend**.
- **A monthly limit.** Routines that cost money may spend $20 a month until you change it. Every run counts, whatever started it, and so do the checks a routine makes before it runs. At the limit they pause until the 1st, and Conch tells you once: on the Routines page, in a notification, and in your chat apps. Choose **Raise the limit** or **Keep paused**. Routines on a plan, or on this computer, carry on.
- **Room for your own chats.** With a subscription, a routine doesn't start while any of your plan's limits is 80% used. Its run says **Waited so your own chats have room**, and goes by itself once the limit resets. A one-off waits too, and runs then.

You choose when routines on a plan wait: at **70%**, **80%**, **90%** or **95%** used, or **Never wait**. The choice is under **Room for your own chats** at the bottom of the Routines page, once a routine runs on a plan, and in **Settings → Usage → Limits**, under **Routines**. Beneath it, Conch says what your choice means for each plan right now. For a routine that must go on time, like a reminder, choose **Always run this one** on its page, or turn on **Run even when the plan is nearly used** in **Edit**. **Run now** always goes.

The monthly limit is in **Settings → Usage → Limits**, under **Routines**, or type "what routines may spend" in <kbd>mod+k</kbd>. Only you can change it, or how much one run may spend. Your assistant can't, whatever it reads.

## Good to know

- To hear only when something matters, without making a routine for it, say it once as a [standing order](check-ins.md): "always tell me if a flight changes".
- Routines only run, and only notice things, while Conch is running. With [Always on](../care/always-on.md), Conch keeps running with no window open.
- Each run starts fresh. It doesn't see the chat that created it, so the instruction should say everything it needs.
- At most two routines run at once. A scheduled run that would be a third, or that comes due while the routine's last run is still going, is skipped, and **History** says why. Something that happened waits for its turn instead.
- If the routine's provider isn't ready (signed out, say), the run waits, and goes by itself once the provider is back.
- **Repair everything** in **Settings → Health** checks what each **When…** routine watches, and says what to do when only you can fix it.
- Routines are plain files in `~/.conch/routines`, and part of every [backup](../care/backups.md).
