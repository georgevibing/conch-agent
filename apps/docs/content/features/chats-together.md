---
title: Chats that work together
description: Your chats know what the others are doing, so two working in the same folder don't undo each other's work.
order: 12.8
nav: Working together
---

Several chats can work at once. Each one knows what the others are up to.

## Ask what's going on

Say "what are my other chats doing?" or "is the deploy chat done?". The chat shows **Checked on your other chats** and how many are busy. Open it to see each chat, and press one to go there.

Your assistant sees, for each of your other chats:

- whether it's working (and for how long), needs you, is done for now, or didn't finish;
- what it's doing: editing files, running a command, using the browser;
- whether it works in the same folder, and the files it has changed so far;
- its [tasks](tasks.md) still going.

It looks by itself before changing files another chat may be working on.

## Two chats, one folder

When another chat is changing files in the folder a chat works in, Conch tells it as its reply starts. A reply already running hears it at its next step. If both change the same file, Conch says that too. A chat running tests or a build there gets a quieter word, once.

A task in its own copy of the folder, or a chat working on [another computer](where-work-runs.md), isn't in the same folder.

Your assistant then keeps to its own files, reads a file again before changing one the other chat changed, and never undoes the other chat's work.

## Wait for another chat

Say "when the login fix is done, write the release notes". Your assistant waits for that chat without checking again and again. A row says **Waiting for “Fix the login”**, and the chat is yours meanwhile.

When the other chat's reply ends, needs you, or is stopped, this one carries on by itself. It hears how the other ended and the end of its last reply. The same works for a [task](tasks.md) it started.

## What stays private

- **Only your chats.** A chat you started, its tasks, a routine's run, your own chat from a [chat app](../channels/index.md). Never one with someone else in it, an [outside agent](agents.md#outside-agents)'s or another app's.
- **A chat with someone else in it isn't told.** Someone you let in on a chat app can't learn what else you're doing.
- **Where a chat is, never what was said in it.** To find something said, your assistant looks through your [earlier chats](memory.md#your-earlier-chats).
