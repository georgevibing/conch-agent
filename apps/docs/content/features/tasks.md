---
title: Hand it off
description: Send a job to the background, keep chatting, and get its result back in the chat you asked in.
order: 9
---

A chat does one thing at a time, and some jobs take a while. Hand one off and it works in the background while you get on with something else. You're told when it's done, and its result comes back to where you asked.

## Send something away

1. Write what you'd like done in the message box, as you would any message.
2. Press <kbd>mod+shift+enter</kbd>, or the **Do it in the background** button that appears once you've written something.
3. Carry on. A card in the chat shows what the task is doing.

You can also ask in words: "do this in the background and tell me when it's done". Or press <kbd>mod+k</kbd> and choose **Do it in the background**.

A task uses the same provider, model and [mode](../reference/modes.md) as the chat it came from. It can do nothing that chat couldn't.

## Watch it work

The card stays where it first appeared and keeps itself current: what the task is doing now, its last few steps, and how long it has been going. When the task finishes, the card shows its result.

**Tasks** in the sidebar lists everything, with a count of what's working, or of what needs your OK. The page puts what needs you first, then what's working, then what's waiting, then what finished. Up to three tasks work at once. The rest wait their turn.

Every task is a chat of its own. **Open** shows it, and there you can read along, answer what it asks, or stop it. **Stop** on the card ends a task at any point.

## When it needs you

A task asks before it acts, as its chat would, and holds nothing else up. Its card says **Needs your OK**, and **See what it's asking** takes you to the question. Other tasks keep working. If nobody answers within an hour, the answer is no.

## When it's done

Conch tells you in the app, and on your devices when notifications are on. The switch is **When a background task finishes**, in **Settings → Notifications**. See [On your phone](../start/phone.md).

A task that didn't finish says why, and **Try again** runs it from the start. If Conch stopped while a task was working, the task says so. On the Tasks page, **Remove** takes a finished task off the list.

## Helpers, side by side

When a job splits into parts that don't need each other, your assistant can run them at once, each with a helper, and bring the results back together. You don't start helpers. Your assistant does, and each one is a card in the chat.

- Helpers use the provider's faster model, unless a part needs the full one.
- A helper that changes code can work in its own copy of the folder, on its own branch. If it changed something, its card names the branch. Conch never merges it for you.
- Helpers run in the chat's mode, stay as careful as their chat, and stop when you stop the chat.
- Once you've spent your monthly budget, your assistant does the parts itself, one at a time.

## Good to know

- A background task can't take [attachments](./files.md) yet. Send those as a message.
- Tasks stay out of your chat list. <kbd>mod+k</kbd> finds one by name. See [Find anything](./find.md).
