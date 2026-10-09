---
title: Tasks
description: Run a job as a task, keep chatting, and get its result back in the chat you asked in.
order: 9
---

A chat does one thing at a time, and some jobs take a while. Run one as a task and it works while you get on with something else. You're told when it's done, and its result comes back to where you asked.

Whether you start a task or your assistant splits a job into several, each one is a task: the same card, the same words, the same controls.

## Start a task

1. Write what you'd like done in the message box, as you would any message.
2. Press <kbd>mod+shift+enter</kbd>, or the **Run as a task** button that appears once you've written something.
3. Carry on. A card in the chat shows what the task is doing.

You can also ask in words: "do this as a task and tell me when it's done". Or type `/task` and what to do, or press <kbd>mod+k</kbd> and choose **Run as a task**.

A task uses the same [agent](./agents.md), provider, model and [mode](../reference/modes.md) as the chat it came from. It can do nothing that chat couldn't: if you chose **Full trust** there, it won't stop to ask here either; if that chat asks first, so does the task. Anything you've already allowed in that chat ("Always allow") counts for its tasks too, and nothing more. Change the mode in the chat and its tasks follow, including one already waiting for your OK.

It also starts as careful as that chat. If the chat had read something from outside, such as a web page or an email, the task's chat says so in one line at the top: **The chat it came from had read 3 sites and one of your chats**. Press that line to see each one. What a task reads comes back to its chat in the same way.

Every provider hands work off this way. Your assistant's own sub-agents are turned off wherever Conch can turn them off, so work always runs as a task you can see, answer and stop.

To have another provider do it, say so: "have Codex CLI do this as a task". Any provider you've connected can take it. Its card says who's doing it.

## Watch it work

The card stays where it first appeared and keeps itself current: what the task is doing now, its last few steps, and how long it has been going. When the task finishes, the card shows its result, and the chat carries on with what it found.

In the chat list, a chat with tasks has a badge on its row saying how many there are and how they're going. Press it for a row per task: what it's doing now, how long it's been, a press to open its own chat, and **Stop** while it works. It opens by itself while something is going.

The pearl by your assistant's name, at the top of the sidebar, says what your tasks are doing across all your chats. It rests when nothing is, breathes while tasks work, turns amber when one needs your OK, and glints once when one finishes. While anything is going, press it for a short list of just those — what needs you first, with **Allow** and **Deny** right there. On a phone, or with the sidebar hidden, it's in the header. Up to three tasks work at once. The rest wait their turn.

A task you start from a new chat, or that another app starts, has no chat to come back to: it shows up in your chat list as a chat of its own, with its card at the top.

Tasks started together, by one reply or one job split into parts, share one card: how many, how they're going in a line and a bar, then a line each. What needs your OK rises to the top and is answered right there. When the last one finishes, the bar folds away and the lines are the result: what each did, or why it didn't.

Every task is a chat of its own. Press one, on its card or under its chat in the chat list, and it opens over the chat you're in: from the bottom on a phone, from the side on a computer. Read along, answer what it asks, or **Stop** it. The tasks started with it sit along the top, a mark each: tap one, swipe sideways on a phone, or use the arrow keys. Close it, or go back, and you're where you were. **Continue in full** opens its own chat, to give it more to do.

## When it needs you

A task asks before it acts, as its chat would, and holds nothing else up. Its card says **Needs your OK** and shows the question right there, with **Allow** and **Deny** — you don't have to leave the chat. A question with a screen of its own (a website, a password, a draft to read) says **See what it's asking** instead, and opens the task's chat. Other tasks keep working. If nobody answers within an hour, the answer is no.

## When it's done

Conch tells you in the app, and on your devices when notifications are on: **Done**, or **Didn't finish** and why. Tasks started together are told about together, once the last one is over ("3 tasks done · 1 didn't finish"). A tap opens the chat they came from. A task waiting for your OK says so on your devices too, under **It needs you**; a notification can deny, but allowing always opens Conch. The switch for finished tasks is **A task finishes**, under **Tell me when** in **Settings → Notifications**. See [On your phone](../start/phone.md).

A task's card says how it went in a word and one line of what came of it, or of what went wrong. Press the chevron for **Details**: its whole result, what was confirmed and what it did. Steps it repeated show once, with how many times (**×6**), and a run of steps of one kind folds into one line, like **Read pager.ts and 3 more**. Press that line to see each step.

Once it's over, a task says how it went:

| It says                 | What it means                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Done**                | It finished. Under Details are the changes Conch could confirm with the tool or provider itself, and links you can open, such as a saved draft. A saved draft is not a sent message.                                                 |
| **Done · Worth a look** | It finished, and there's a reason to look, said in a few words: an action whose result it couldn't confirm, or something it was asked for that isn't confirmed. Its summary is kept, but not taken as proof, even if it says "done". |
| **Didn't finish**       | Something went wrong, or Conch stopped while it was working. The card says why in a line.                                                                                                                                            |
| **Stopped**             | You stopped it.                                                                                                                                                                                                                      |

For a task that only asks for an answer, Conch checks that a nonempty answer was saved for this attempt. An empty reply is flagged for inspection. This confirms delivery, not the factual accuracy of what the assistant wrote.

When your assistant hands off work that needs tools, it can set checks before the task starts: which observations or actions must have receipts, and the exact target or content when known. Missing receipts remain visible even if the assistant says it finished. The checks carry through a restart and cannot grant permission to use a tool.

Partial results stay visible after a task didn't finish or was stopped.

**Resume safely** continues in the same chat with saved progress. It does not restart from a blank conversation. Confirmed writes are not repeated. If Conch lost a provider's response and cannot prove whether a write happened, it stops rather than create a duplicate. Open the original app to inspect the result. A search returning no matches is not always proof that a write failed.

After a restart or backup restore, both running and queued tasks wait for you to resume. Their saved results and conversation remain available. Old approval cards are cleared, and anything needing approval asks afresh. The task checks the current permission limits and security restrictions of the chat it came from. Old approval answers do not carry over. A declined approval that provably prevented a write can be asked again; a lost network response cannot be treated as a decline. An account change or renewed consent cannot silently reuse an earlier account's operations.

A resumed task keeps its original work folder even if you changed your default workspace. A task that changes code keeps its branch and worktree through an interruption. If Conch deliberately removed a clean worktree after completion, it can reopen it at the saved starting commit; a folder missing unexpectedly requires recovery instead of silently using a different folder.

Open a finished task and type a clarification or revision to continue. The same tool and account boundaries remain; asking a draft-only job to send a message does not give it permission to send. Previous results remain inspectable, but do not by themselves verify a revised goal.

In a task that's a chat of its own, **Remove** on its card hides the finished task. Conch retains its operation receipts and request identity to prevent repeated effects; removing a card does not undo changes in other apps. Task goals and receipts are included with chats in backups. Restoring merges newer local receipts rather than erasing them. A restored task cannot issue a new write when the historical backup cannot prove whether it already happened; inspect the original app before starting a new job.

## Several at once

When a job splits into parts that don't need each other, your assistant can run them at once, each as a task, and bring the results back together. Tasks started together share one card in the chat, a line each.

- One job splits into at most six parts. Helpers can't ask you a question with choices; anything that needs your OK still asks, as above.
- They use the provider's faster model, unless a part needs the full one.
- A task can go to another provider you've connected. Ask for it ("have Codex write the tests while you fix the bug"), or your assistant picks one when it plainly suits a part, like a coding agent for changing code. The card says **by** which provider.
- A task that changes code can work in its own copy of the folder, on its own branch. If it changed something, its card names the branch. Conch never merges it for you.
- Whichever provider does the work, they run in the chat's mode, stay as careful as their chat, keep to the same skills' limits, and stop when you stop the chat. A provider that can't work in that mode uses its safest one.
- Once you've spent your monthly budget, your assistant does the parts itself, one at a time.

## Good to know

- A task can't take [attachments](./files.md) yet. Send those as a message.
- Tasks stay out of your chat list; they sit under the chat that started them. <kbd>mod+k</kbd> finds one by name, whoever started it. See [Find anything](./find.md).
- They tidy themselves away. One that finished while you were elsewhere stands out under its chat, with a dot, until you've seen it: open it, or open the chat it came from. Then it folds under **Earlier**. Once nothing is working or new, the chat is a single line again, and its tasks are on their cards in the chat. Seen on your phone is seen on your computer too.

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

Time observations made with Conch’s `current_time` tool are recorded too. Codex clock requests use that same tool, and its reported native tool calls appear in the history. Each entry records what Conch observed; a provider’s success message alone does not prove an external change happened. Older providers that do not report an internal operation can use Conch’s tools when a recorded observation is needed.
