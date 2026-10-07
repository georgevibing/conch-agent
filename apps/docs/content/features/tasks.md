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

A task uses the same [agent](./agents.md), provider, model and [mode](../reference/modes.md) as the chat it came from. It can do nothing that chat couldn't: if you chose **Full trust** there, it won't stop to ask here either; if that chat asks first, so does the task. Anything you've already allowed in that chat ("Always allow") counts for its tasks too, and nothing more. Change the mode in the chat and its tasks follow, including one already waiting for your OK.

Every provider hands work off this way. Your assistant's own sub-agents are turned off wherever Conch can turn them off, so work always runs as a task you can see, answer and stop.

To have another provider do it, say so: "have Codex CLI do this in the background". Any provider you've connected can take it. Its card says who's doing it.

## Watch it work

The card stays where it first appeared and keeps itself current: what the task is doing now, its last few steps, and how long it has been going. When the task finishes, the card shows its result, and the chat carries on with what it found.

In the chat list, a chat with tasks has a small badge on its row saying how many there are and how they're going. Press it for a row per task: what it's doing now, how long it's been, a press to open its own chat, and **Stop** while it works. It opens by itself while something is going.

The pearl by your assistant's name, at the top of the sidebar, says what's going on in the background across all your chats. It rests when nothing is, breathes while tasks work, turns amber when one needs your OK, and glints once when one finishes. While anything is going, press it for a short list of just those — what needs you first, with **Allow** and **Deny** right there. On a phone, or with the sidebar hidden, it's in the header. Up to three tasks work at once. The rest wait their turn.

A task you start from a new chat, or that another app starts, has no chat to come back to: it shows up in your chat list as a chat of its own, with its card at the top.

Every task is a chat of its own. **Open** shows it, and there you can read along, answer what it asks, or stop it. **Stop** on the card ends a task at any point.

## When it needs you

A task asks before it acts, as its chat would, and holds nothing else up. Its card says **Needs your OK** and shows the question right there, with **Allow** and **Deny** — you don't have to leave the chat. A question with a screen of its own (a website, a password, a draft to read) says **See what it's asking** instead, and opens the task's chat. Other tasks keep working. If nobody answers within an hour, the answer is no.

## When it's done

Conch tells you in the app, and on your devices when notifications are on. The switch is **When a background task finishes**, in **Settings → Notifications**. See [On your phone](../start/phone.md).

A task's card says how it went in a word and one line of what came of it, or of what went wrong. Press the chevron for **Details**: its whole result, what was confirmed and what it did.

**Finished** means the assistant finished a general task that had no automatic completion criteria. This is not an error. You can read its result and, under Details, the recorded tool results; running it again would not add missing criteria.

**Done** means Conch checked the workflow's required results against real tool or provider receipts. The card lists confirmed changes and links you can inspect, such as a saved draft. A saved draft is not a sent message.

**Needs a look** means the assistant finished replying, but required results are missing, an action is uncertain, or a tool could not independently check its outcome. Its summary is preserved, not treated as evidence. The card explains what remains unchecked, even if the assistant says “done”. Partial results stay visible after failure or cancellation.

**Resume safely** continues in the same chat with saved progress. It does not restart from a blank conversation. Confirmed writes are not repeated. If Conch lost a provider's response and cannot prove whether a write happened, it stops rather than create a duplicate. Open the original app to inspect the result. A search returning no matches is not always proof that a write failed.

After a restart or backup restore, both running and queued tasks wait for you to resume. Their saved results and conversation remain available. Old approval cards are cleared, and anything needing approval asks afresh. The task checks the current permission limits and security restrictions of the chat it came from. Old approval answers do not carry over. A declined approval that provably prevented a write can be asked again; a lost network response cannot be treated as a decline. An account change or renewed consent cannot silently reuse an earlier account's operations.

A resumed task keeps its original work folder even if you changed your default workspace. A code helper keeps its branch and worktree through an interruption. If Conch deliberately removed a clean worktree after completion, it can reopen it at the saved starting commit; a folder missing unexpectedly requires recovery instead of silently using a different folder.

Open a finished task and type a clarification or revision to continue. The same tool and account boundaries remain; asking a draft-only job to send a message does not give it permission to send. Previous results remain inspectable, but do not by themselves verify a revised goal.

In a task that's a chat of its own, **Remove** on its card hides the finished task. Conch retains its operation receipts and request identity to prevent repeated effects; removing a card does not undo changes in other apps. Task goals and receipts are included with chats in backups. Restoring merges newer local receipts rather than erasing them. A restored task cannot issue a new write when the historical backup cannot prove whether it already happened; inspect the original app before starting a new job.

## Helpers, side by side

When a job splits into parts that don't need each other, your assistant can run them at once, each with a helper, and bring the results back together. You don't start helpers. Your assistant does, and each one is a card in the chat.

- Helpers use the provider's faster model, unless a part needs the full one.
- A helper can be another provider you've connected. Ask for it ("have Codex write the tests while you fix the bug"), or your assistant picks one when it plainly suits a part, like a coding agent for changing code. The card says **by** which provider.
- A helper that changes code can work in its own copy of the folder, on its own branch. If it changed something, its card names the branch. Conch never merges it for you.
- Whichever provider does the work, helpers run in the chat's mode, stay as careful as their chat, keep to the same skills' limits, and stop when you stop the chat. A provider that can't work in that mode uses its safest one.
- Once you've spent your monthly budget, your assistant does the parts itself, one at a time.

## Good to know

- A background task can't take [attachments](./files.md) yet. Send those as a message.
- Tasks stay out of your chat list; they sit under the chat that started them. <kbd>mod+k</kbd> finds one by name, helpers included. See [Find anything](./find.md).

## Control work from the chat

Ask what a task is doing, ask to stop it, or give it another instruction once it
finishes. The assistant can list and control work started in that chat. It cannot
reach tasks from a different chat. Retrying retains the task’s evidence and
permission limits; it does not start with a clean slate.

A failed exploratory read does not prevent the rest of a task from finishing.
Conch keeps each read attempt, so an old result cannot stand in for a failed new
read. Local file edits and artifact updates are checked against their saved
contents or versions. A tool that finished without an independent check is shown
as such; a write whose result is uncertain is kept for inspection, never blindly
repeated. The assistant can use task status to see which results are missing and
which tools lack independent checks.

The operation history contains evidence Conch received through its tools and provider result hooks. Utilities a provider runs internally without reporting a tool event, such as its own clock, may not appear; this history is not a complete trace of the provider’s internals.
