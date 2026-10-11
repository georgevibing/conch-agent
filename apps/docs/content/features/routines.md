---
title: Routines
description: Your assistant does something at a set time, like a morning briefing, or when something happens, like an email from someone you're waiting on.
order: 3
---

A routine is something your assistant does without being asked each time. It starts one of two ways:

- **Every…** at a time: a morning briefing, a weekly review, a reminder at five.
- **When…** something happens: an email from Anna, a meeting about to start, a page that changed, a task that finished.

Nothing runs until you turn it on.

## Make one

Ask in any chat: "every weekday at 8, tell me what's on my calendar", or "tell me when Anna replies". Your assistant drafts it as a card.

- **Turn on** starts it.
- **Try it now** runs it once first. A **When…** routine tries itself on the latest match, like Anna's last email.
- **Edit** changes the words, the start, or what it may do.
- **Not now** keeps it, paused.

Or open **Routines** in the sidebar: describe it and press **Draft it**, pick an idea, or choose **Set it up yourself**. In <kbd>mod+k</kbd>, **New routine that starts when…** opens with **When…** chosen.

**Who runs it.** A routine drafted in a chat runs as that chat's [agent](./agents.md), on its provider and model. One made on the Routines page uses your default agent. In **Edit**, **Answered by** picks another agent (or **Default agent**, whoever is default when it runs), and **Model** picks the provider and model.

**What it can do.** Whatever a chat can: your [apps](apps.md), your Conch apps and the browser. It can write to you in any connected [chat app](../channels/index.md): "every morning, send the weather to my Telegram".

You can also ask in a chat to see, change, pause or delete routines.

## Every…

Under **Repeats**, choose **Once**, **Every day**, **Weekdays**, **Weekly**, **Monthly** or **Every few hours**. **Custom** takes a cron expression. Conch says it back in words and lists the next runs. At most every 15 minutes.

A time missed while Conch was off runs once when it's back. To skip it instead, turn off **Catch up if Conch was off**.

## When…

Under **Starts**, choose **When…**, then what starts it:

- **An email arrives**, from people you write to or about some words. Needs [Gmail](apps.md).
- **Before a meeting**, some minutes before each event, or only meetings with others. Needs Google Calendar.
- **A page changes.** Conch reads it hourly, or as often as you choose. Menus, times, dates and ads don't count.
- **A folder changes.** Pick it with **Choose a folder…**. Conch waits for changes to settle and ignores its own.
- **A task finishes**: one of your [background tasks](tasks.md).
- **Another routine runs**, like "after the morning briefing".

Under **Advanced**, **Another app sends a message** gives the routine its own web address, for a shop, a form or GitHub. It needs the [public address](../channels/index.md) on. Copy it from the routine's page and press **Add a secret**, shown once, so only your app can use it.

**Only if…** narrows it: "only if it's about the invoice". A small model checks each event first, for a fraction of a cent. When unsure, the routine runs and says so.

- Watching costs nothing: the card says **Free until something happens**.
- The run sees what happened, and its line in **History** links to it.
- Many events at once become one run. At most four runs an hour; more wait for the next.
- Email and meetings from while Conch was off still count. Folder changes don't.

After you connect Gmail or Google Calendar in **Apps**, Conch offers the best-fitting routine, once.

## What it may do while you're away

Each routine says how far it may go without you:

- **Ask me first.** The run pauses and asks before each change. Routines drafted in a chat start here.
- **Auto.** It asks only before risky steps. Routines you make yourself start here.
- **Allow everything.** It runs commands and changes anything, unasked. Only for tasks you fully trust.

A **When…** routine starts from something someone else wrote, so anything that could send things out or change your computer asks first, whatever you chose.

Only you can turn a routine on or give it more room. If your assistant rewrites what it does or what starts it, it pauses at **Ask me first** until you turn it on.

## Read what it did

A routine's **History** lists every run in a line. Each run is a chat you can open and reply to.

- A run that waits for you or didn't finish puts its routine under **Needs you** at the top of the page. So does a **When…** routine that can't look, like when Gmail needs you to sign in again.
- With [notifications](../start/phone.md) on, Conch tells you when a routine ran. A run with nothing to say stays quiet.
- A [channel](../channels/index.md) with **Routine results** on sends the result to your chat app.

**Run now** (or **Try it now**) runs it straight away.

## What it costs

Each routine shows its cost beside its schedule, and each run in **History** shows its own:

- **About $1.20 a month** on a pay-as-you-go provider. Before its first run it says **Roughly**. If the model's price is unknown, it says nothing.
- On a subscription, the plan it runs on, like **Runs on your Claude Max plan**, then how much of the plan's limit a run takes.
- **Free on this computer** with a local model.
- **Free until something happens** for a **When…** routine, with the cost of one run: **About $0.04 a run**.

In **Edit**, a reminder can use a smaller, cheaper **Model**. Your assistant may pick your provider's small model for a simple routine, never a bigger one.

## It won't run up a bill

Three guards, on from the start:

- **A run that does far more than usual stops**, at about three times its usual cost (or a typical briefing's, before its first run), never less than $1. It ends under **Needs you** with why. **Let it use more** gives it more room; **Edit** sets an exact **Most one run may spend**.
- **A monthly limit** of $20 for routines that cost money, until you change it. Every run and **Only if…** check counts. At the limit they pause until the 1st, and Conch tells you once: on the Routines page, in a notification and in your chat apps. Choose **Raise the limit** or **Keep paused**. Routines on a plan or this computer carry on.
- **Room for your own chats.** On a subscription, a routine doesn't start while any plan limit is 80% used. Its run says **Waited so your own chats have room** and goes once the limit resets.

Choose when plan routines wait: **70%**, **80%**, **90%**, **95%** or **Never wait**, under **Room for your own chats** at the bottom of the Routines page, or in **Settings → Usage → Limits**, under **Routines**.

For one that must go on time, choose **Always run this one** on its page, or turn on **Run even when the plan is nearly used** in **Edit**. **Run now** always goes.

Change the monthly limit in **Settings → Usage → Limits**, under **Routines**, or type "what routines may spend" in <kbd>mod+k</kbd>. Your assistant can't change any of these.

## Good to know

- To hear only when something matters, give a [standing order](check-ins.md) instead: "always tell me if a flight changes".
- Routines run only while Conch does. With [Always on](../care/always-on.md), it runs with no window open.
- Each run starts fresh, without the chat that made it, so the instruction should say everything.
- At most two routines run at once. A scheduled run that would be a third, or that comes due while its last run is going, is skipped, and **History** says why. An event waits its turn.
- If the routine's provider isn't ready, the run waits for it.
- **Repair everything** in **Settings → Health** checks what each **When…** routine watches.
- Routines are plain files in `~/.conch/routines`, and in every [backup](../care/backups.md).
