---
title: How Conch works on a problem
nav: Working on a problem
description: Your assistant keeps going when something fails, tries another way, checks its work, and stops only for what needs you.
order: 12.5
---

Ask for something, and your assistant works at it until it's done, whatever the provider or model.

## When something fails

A command errors, a page won't load, an app finds nothing. Your assistant:

- reads all of what went wrong, and checks the likely cause;
- changes something before trying again, never repeating the same step;
- tries once more for things that pass by themselves, like a busy service;
- then finds another way: another tool, page or method.

An empty answer is a clue too. If an app finds no invoices for "ACME Corp", it checks what the app calls that customer before telling you they owe nothing.

## Before it says "done"

It runs the test, reads the file back, looks at the page, or does the sum again. It says something worked only when it has seen it work.

## When it stops for you

It stops and asks when the next step needs:

- your OK, where your [permission mode](../reference/modes.md) asks first;
- you to sign in, or a password or key it doesn't have;
- spending, sending or deleting something;
- a choice that's yours.

If you say no, it doesn't look for another way to do the same thing. In **Read only**, it looks into the problem and changes nothing until you press **Start**.

## When it has to wait

Some jobs mean waiting: for CI after a push, a long test run, a page to change, or a set time. Say "watch CI and fix it if it fails". Conch does the watching, so your assistant isn't called again until something happens.

- **One row in the chat** shows what it's waiting for, how long it's been, and when Conch looks next. For CI, each check is a dot that fills green or red.
- **The chat is still yours.** Your assistant's reply ends, and it carries on by itself when the wait is over, like "CI finished: 2 failed".
- **Check now** looks at once. **Stop waiting** ends it without waking your assistant.
- If you asked, you're told on your phone and your chat app.

Conch looks often at first, then less while nothing changes. It reads only how the checks stand, never your code. It uses GitHub's own program when you're signed in to it, otherwise the GitHub app you connected in [Apps](apps.md). A public repository needs neither.

A wait gives up after an hour unless your assistant asks for longer, then your assistant decides what's next. Waits carry on after Conch restarts.

A wait for one of your assistant's own commands keeps the reply open, because the command stops when the reply does. Your next message is sent once the wait is over. If a provider checks again and again anyway, the chat says so: "Still running · checked 4 times in 2 minutes, nothing new yet".

## When it's stuck

It tells you in a few lines: what it tried, what's in the way, and the one thing you can do next. It never claims something worked when it didn't.

Background [tasks](tasks.md) do all they can, then say what's left for you in their result.

## Conch helps it along

- **Errors it can act on.** When a Conch tool fails, your assistant reads what actually happened, like the command's own output.
- **A nudge after a run of failures.** Conch tells your assistant to step back and try a different way.
- **Apps that drop reconnect.** Conch reopens the connection and repeats a lookup, but never a change, since it can't tell whether that happened.
- **Small models get the short version** of these rules, leaving room for your chat.

How long one message may run before it checks in is up to you, in **Settings → Usage → Limits**. See [your chats](chats.md).
