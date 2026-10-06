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

These questions offer no **Always allow**. Once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted), Auto also asks before the usual ways out: a push, a new package, sending data, an app's change. With Claude Code, Auto uses Claude Code's own auto mode as well, where the model has it.

## Full trust

**Full trust** never stops to ask, with every provider. What still holds, because your trust can't reach it:

- deleting a whole folder like your home, the work folder or a disk asks;
- Passwords and Conch's own keys stay out of reach, and the assistant can't change who may use Conch;
- a tool you turned **Off** stays off;
- someone else's words in the chat, a routine or a chat app that read something, and a skill's list still ask;
- paying or deleting on a website asks.

## In every mode

In **Ask first**, **Edit freely** and **Plan only**, anything that sends, spends or deletes asks first once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted); **Always allow** on that question lets it through for the rest of the chat. A command that wants out of the sealed box (to clone a repository or install something) asks too, with **Always allow**, except in Full trust, and in Auto until the chat reads something. Whatever the mode, paying or deleting in [the browser](../features/browser.md) asks. A [task](../features/tasks.md) never has more than its chat.
