---
title: Chats that work together
description: Your chats know what the others are doing, wait for each other, send each other messages, and never undo each other's work.
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

Say "when the login fix is done, write the release notes". Your assistant waits for that chat without checking again and again. A row says **Waiting for “Fix the login”**, with **Open** to go there, and the chat is yours meanwhile.

When the other chat's reply ends, needs you, or is stopped, this one carries on by itself. It hears how the other ended and the end of its last reply, with passwords and keys taken out. If the other chat is itself waiting for something, this one keeps waiting. The same works for a [task](tasks.md) it started.

## Send another chat a message

Say "tell the deploy chat to hold off, I'm changing package.json". Your assistant sends it. The other chat reads it at its next step if it's working, or when its next reply starts. Ask for it to start that reply now ("tell it the build is fixed and to carry on") and it does.

Both chats show the message on a card: **To** where it was sent, with whether it's been read, and **From** where it came. Press the other chat's name to go there.

A message is the other chat's assistant writing, never you. It can't give permission for anything or answer a question for you. If the chat that sent it read a page or an email, the one that gets it is as careful. A reply a message starts runs as if you weren't watching: in **Full trust**, it still asks. Passwords and keys are taken out of what's sent.

### Stop another chat

Say "stop the other chat". Your assistant stops its reply and says why on its card. In **Ask** mode, or once the chat asking has read something from outside, it asks you first.

### Choose what a chat lets in

In the chat's menu in the list, choose **Messages from other chats**, or press **⋯** on a message that came to it:

- **Let them in**: your other chats can message it. This is the default.
- **Hold them for me**: each message waits on its card until you press **Pass it on** or **Dismiss**.
- **Turn them away**: your other chats can't message it.

### Chats can't keep each other going

A chain of messages that started with yours can go only so far: eight messages, four replies started, three between the same two chats, five waiting for any one chat, and never the same words twice. Write in a chat and it starts afresh.

## What stays private

- **Only your chats.** A chat you started, its tasks, a routine's run, your own chat from a [chat app](../channels/index.md). Never one with someone else in it, an [outside agent](agents.md#outside-agents)'s or another app's.
- **A chat with someone else in it isn't told.** Someone you let in on a chat app can't learn what else you're doing.
- **Where a chat is, never what was said in it.** To find something said, your assistant looks through your [earlier chats](memory.md#your-earlier-chats).
