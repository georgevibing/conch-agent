---
title: Permission modes
description: How much your assistant may do without asking. Pick one per chat, and a default for new ones.
order: 4
---

Change it from the composer, or with `/mode`; set where new chats start in **Settings → Models**. Every provider offers every mode, and each one means the same with all of them: where a provider has no way of its own, Conch does it.

<!-- conch:modes -->

## Auto

**Auto** gets on with the work and stops only for something serious. It goes ahead with edits, commands, installs, pushes and your apps. It stops to ask, saying why, before it would:

- run code downloaded from the internet, or install straight from an address;
- read your keys or saved sign-ins, or send something to an address made for catching data;
- delete files outside the work folder, or force-push over a branch others share;
- run something as administrator, or turn off a safety check of your computer;
- tear down or change production infrastructure, wipe a database, publish a package;
- delete something in one of your apps.

- stop programs your computer runs on, restart it, or change its own system files;
- delete a repository's history, or the data a container kept.

These questions offer no **Always allow**. Everyday work never asks, outside the sealed box too: checking, pulling and fetching with git, installing what the project lists, building, testing, tidying the work folder. Spending money asks (a paid picture); your own plan, at no extra charge, doesn't.

Once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted), Auto still gets on with everyday work, and asks only before the ways something could leave: a push, a new package, sending data or what a command printed, an app's change, words to other people. An unusual command that could reach the internet or your sign-ins also gets a second look from a small model you already have; the look can only add a question. Conch's own lists of models and the pictures it makes don't count as reading something from outside. With Claude Code, Auto uses Claude Code's own auto mode as well, where the model has it.

## Full trust

**Full trust** never stops to ask, with every provider. What still holds, because your trust can't reach it:

- deleting a whole folder like your home, the work folder or a disk asks;
- Passwords and Conch's own keys stay out of reach, and the assistant can't change who may use Conch;
- a tool you turned **Off** stays off;
- someone else's words in the chat, a routine or a chat app that read something, and a skill's list still ask;
- paying or deleting on a website asks.

## In every mode

In **Ask first**, **Edit freely** and **Plan only**, anything that sends, spends or deletes asks first once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted); **Always allow** on that question lets it through for the rest of the chat. A command that wants out of the sealed box (to clone a repository or install something) asks too, with **Always allow**, except in Full trust and Auto. In Auto it asks only for what Auto would stop anyway, or, with someone else's words in the chat or nobody there, once the chat reads something. Whatever the mode, paying or deleting in [the browser](../features/browser.md) asks. A [task](../features/tasks.md) never has more than its chat.
