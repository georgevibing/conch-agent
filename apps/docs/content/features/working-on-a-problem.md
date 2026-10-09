---
title: How Conch works on a problem
nav: Working on a problem
description: Your assistant keeps going when something fails, tries another way, checks its work, and stops only for what needs you.
order: 12.5
---

Ask for something, and your assistant works at it until it's done. That's the same with every provider and every model, whatever you named your assistant and however it talks.

## When something fails

A command errors, a page won't load, an app finds nothing. Your assistant doesn't stop there. It:

- reads what went wrong, all of it;
- works out the likely cause, and checks it;
- changes something before it tries again. It never repeats the same step and hopes;
- tries once more for things that pass by themselves, like a busy service;
- then finds another way to the same result: another tool, another page, another method.

An empty answer is a clue too. If an app finds no invoices for "ACME Corp", your assistant checks what the app calls that customer before it tells you they owe nothing.

## Before it says "done"

It checks. It runs the test, reads the file back, looks at the page, or does the sum again. It says something worked only when it has seen it work.

## When it stops for you

Some things only you can do. Your assistant stops and asks when the next step needs:

- your OK, where your [permission mode](../reference/modes.md) says Conch asks first;
- you to sign in, or a password or key it doesn't have;
- spending, sending or deleting something;
- a choice that's yours to make.

If you say no, it doesn't look for another way to do the same thing. In **Read only**, it looks into the problem just as hard, and changes nothing until you press **Start**.

## When it's stuck

It tells you plainly, in a few lines: what it tried, what's in the way, and the one thing you can do next. It never says something worked when it didn't, and never makes up a result.

Background [tasks](tasks.md) work the same way. Nobody is there to ask, so a task does everything it can, then says what's left for you in its result.

## Conch helps it along

- **Errors it can act on.** When one of Conch's tools fails, your assistant reads what actually happened, like the command's own output, not just "that didn't work".
- **A word after a run of failures.** After several failed steps in a row, Conch tells your assistant to step back and try a different way.
- **Apps that drop reconnect.** If an app's connection drops partway, Conch opens it again. A lookup is asked again. A change is never repeated by itself, because Conch can't tell whether it already happened.
- **Small models get the short version.** A model that reads little at once gets the same rules in a few lines, so there's room left for your chat.

How long one message may run before it checks in with you is up to you, in **Settings → Usage → Limits**. See [your chats](chats.md).
