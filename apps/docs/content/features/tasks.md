---
title: Tasks
description: Run a job as a task, keep chatting, and get its result back in the chat you asked in.
order: 9
---

Run a long job as a task and keep chatting. You're told when it's done, and the result comes back where you asked. Tasks you start and parts your assistant splits off look and work the same.

## Start a task

1. Write what you'd like done in the message box.
2. Press <kbd>mod+shift+enter</kbd> or **Run as a task**.
3. Carry on. A card in the chat shows its progress.

Or type `/task` and what to do, choose **Run as a task** in <kbd>mod+k</kbd>, or ask: "do this as a task". To use another connected provider, say so: "have Codex CLI do this as a task". The card says who's doing it.

### What a task may do

A task uses its chat's [agent](./agents.md), provider, model and [mode](../reference/modes.md), and can do nothing that chat couldn't.

- If the chat asks first, so does the task. In **Full trust**, neither does.
- **Always allow** answers from the chat count for its tasks, and nothing more.
- In **Auto**, what you asked for in the chat counts for its tasks too, so a task doesn't stop to ask about work you already asked for. It's what you'd said when you handed it off: say "stop" later and tell the task too, or stop it. Nothing carries from a routine, or from a chat with someone else's messages in it.
- Change the chat's mode and its tasks follow, even one waiting for your OK.
- If the chat had read something from outside, the task starts as careful, and says so at the top: **The chat it came from had read 3 sites and one of your chats**. Press it to see each one. What a task reads comes back to its chat the same way.

Conch turns off your assistant's own sub-agents wherever it can, so all handed-off work is a task you can see, answer and stop.

## Watch it work

The card stays where it appeared and shows what the task is doing, its last few steps and how long it's been. When it finishes, the card shows the result and the chat carries on with it.

- **Chat list:** a badge on the chat's row counts its tasks. Press it for a row each, with **Stop**. It opens by itself while something is going.
- **The pearl** by your assistant's name (in the header on a phone) covers all chats. It breathes while tasks work, turns amber when one needs your OK, and glints when one finishes. Press it for a list, with **Allow** and **Deny**.
- **No chat to return to?** A task started from a new chat or by another app becomes a chat of its own.

Tasks started together share one card: a bar for the batch, then a line each. What needs your OK rises to the top. When the last finishes, the lines become the result.

### Open a task

Every task is a chat. Press one to open it over the chat you're in. Read along, answer it or **Stop** it. Move between the tasks started with it from the marks along the top, by swiping on a phone, or with the arrow keys. **Continue in full** opens its own chat, to give it more to do.

## How many at once

As many as your computer and provider have room for. The next starts by itself when there's room.

- **Sized up first:** light (reading, writing), medium (a few files) or heavy (a build, a test run, a big download). When it may, Conch also asks your provider's small model, once per batch, without waiting for it. Turning off **Name new chats automatically** in **Settings → General** stops that.
- **Fitted to your computer:** processor, free memory and running commands. Nothing working is stopped to make room.
- **Fair:** one chat's six tasks can't keep another's one waiting. A batch starts together when it fits.
- **Same file, one at a time.** Name the file in what you ask.
- **Paced by your provider:** if it asks Conch to slow down, its tasks wait. Others carry on.

A waiting task says why:

| It says                                                       | What it means                                  |
| ------------------------------------------------------------- | ---------------------------------------------- |
| **Starts when “Fix the login” finishes**                      | Every place is taken. Usually with a time.     |
| **Starts when “Fix the login” finishes: both change auth.ts** | Both change the same file.                     |
| **Starts after “Read the README”**                            | It needs that result first.                    |
| **Waiting for memory: 2 heavy tasks working**                 | Your computer is short of memory.              |
| **Waiting for the processor: this computer is busy**          | It starts once the processor settles.          |
| **Codex asked Conch to slow down · trying again in 20s**      | Your provider asked for a pause.               |
| **Waiting while Conch recovers**                              | Conch restarts work gently after a busy spell. |

A batch card says how many fit: **3 at once on this computer right now**.

**Start now** (on the card, its line and in <kbd>mod+k</kbd>) starts a task waiting only for room, a little past what Conch would choose. It isn't offered when memory is short, while Conch recovers, for the same file, or when your provider asked to slow down.

## When it needs you

A task asks before it acts, as its chat would, and holds nothing else up. Its card says **Needs your OK**, with **Allow** and **Deny**. A question with its own screen (a website, a password, a draft) shows **See what it's asking** instead. No answer within an hour means no.

## When it's done

Conch tells you in the app, and on your devices when notifications are on. A batch is reported once, when the last is over ("3 tasks done · 1 didn't finish"). A tap opens the chat. Asking for your OK notifies under **It needs you**: a notification can deny, but allowing opens Conch. Finished tasks are under **A task finishes**, in **Settings → Notifications → Topics** ([On your phone](../start/phone.md)).

Ask your assistant to carry on once a task is done ("when the build's done, deploy it") and it waits without checking again and again. The chat stays yours meanwhile, a row says what it waits for, and the next step starts by itself when the task finishes.

The chevron opens **Details**: the whole result, what was confirmed and each step. Repeats show once (**×6**), and similar steps fold into one line, like **Read pager.ts and 3 more**.

| It says                 | What it means                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Done**                | It finished. **Details** lists confirmed changes and links, like a saved draft. A saved draft is not a sent message.                       |
| **Done · Worth a look** | It finished, but something it did or was asked for isn't confirmed. Its summary isn't taken as proof. **Checked** clears it from the chat. |
| **Didn't finish**       | Something went wrong, or Conch stopped mid-way. The card says why.                                                                         |
| **Stopped**             | You stopped it.                                                                                                                            |

### What Conch checks

- **An answer-only task:** that a nonempty answer was saved. That proves delivery, not accuracy.
- **Reading and lookups** (`ls`, `git status`, loading a tool) are never checked. Neither are steps Conch held back, since they never happened.
- **Checks set up front:** for tool work, your assistant can name which actions need receipts, and their exact target. Missing receipts stay visible whatever the assistant says. Checks survive a restart and grant no permissions.
- When Conch can't vouch for a task, its chat hears why in a line.

## Pick up where it stopped

Partial results stay. **Resume safely** carries on in the same chat from saved progress.

- Confirmed writes aren't repeated.
- If Conch can't prove whether a write happened, it stops rather than duplicate it. Check the original app. No search match isn't always proof it failed.
- After a restart or backup restore, tasks wait for you to resume. Old approvals are cleared and asked afresh, under the chat's current limits. A lost network response is never treated as a decline.
- An account change can't quietly reuse an earlier account's operations.
- A resumed task keeps its work folder, branch and worktree. Conch never quietly swaps in a different folder.
- A resumed task opens its own browser again, signed in, on the same pages ([Tasks have a browser of their own](./browser.md#tasks-have-a-browser-of-their-own)).

Open a finished task and type to give it more to do. Its limits stay: a draft-only job can't start sending. Earlier results don't prove a changed goal.

**Remove**, in a task's own chat, hides it. It doesn't undo anything in other apps. Conch keeps its receipts, in backups too, so effects aren't repeated. A restored task won't make a write the backup can't prove hasn't happened.

## Several at once

When a job splits into independent parts, your assistant can run them as tasks on one card and bring the results together.

- At most six parts, started as there's room.
- Parts can't ask you multiple-choice questions. Anything needing your OK still asks.
- They use the provider's faster model unless a part needs the full one.
- A part can go to another connected provider ("have Codex write the tests"), or your assistant picks one that plainly suits. The card says **by** whom.
- A code-changing part can work on its own branch, named on its card. Conch never merges it for you.
- Every part keeps the chat's mode, caution and skill limits, and stops with the chat. A provider that can't use that mode uses its safest.
- Past your monthly budget, your assistant does the parts itself, one at a time.

## Control work from the chat

Ask what a task is doing, to stop it, or to do more once it's done. Your assistant controls only tasks from that chat. Retrying keeps the task's evidence and limits.

- A failed read doesn't stop the rest, and an old result can't stand in for it.
- File edits and artifact updates are checked against their saved versions.
- A write with an uncertain result is kept for you to check, never blindly repeated.
- Times read with Conch's `current_time` tool are recorded too. A provider's success message alone doesn't prove an outside change.

## Good to know

- A task can't take [attachments](./files.md) yet. Send those as a message.
- Tasks sit under their chat, not in the chat list. <kbd>mod+k</kbd> finds any by name ([Find anything](./find.md)).
- A task that finished while you were away shows a dot until you open it or its chat, then folds under **Earlier**. Seen on one device is seen on all.
