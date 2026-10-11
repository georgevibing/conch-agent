---
title: Your chats
description: Pin, file and tidy chats, keep drafts, choose who answers, queue messages, set a goal and keep long chats going.
order: 12
---

Your chats are in the sidebar. Press **⋯** beside one, right-click it, or hold it on a phone for its menu.

## Your list

From the top, empty parts hidden:

- **Apps.** Pinned app pages as tiles, most used first. Point at one to see where it's from; right-click or hold it for **Unpin** and the app's details. With more than fit, the last tile is **All apps**: every app as a folder, with a search. **Open Apps** at its foot goes to [Apps](apps.md).
- **Needs you**, **Pinned**, then **Folders**.
- **Everything else, by when.** Today, Yesterday, Previous 7 days, Previous 30 days, then one group per month.
- **Archived**, at the end.

### What each chat is doing

- **The pearl:** working.
- **An amber dot:** needs you.
- **A dot and a bolder title:** something new while you were away, like a finished reply or a message from a [chat app](../channels/index.md). Opening the chat clears it, on your phone too.
- **A red dot:** the last reply didn't finish.

The menu beside **Chats** shows **All chats**, only **New**, or only **From chat apps**.

### Pin a chat

**Pin** keeps a chat at the top, with no limit. Drag to reorder, or use **Move up** and **Move down**. Archiving unpins.

### Folders

Choose **Move to → New folder…**, name it, and pick a mark and a colour. Then:

- Drag chats onto it, or choose **Move to** and the folder.
- Press its name to fold or unfold it.
- **✎** beside it starts a chat inside it; **✕** on the new chat page starts it outside instead.
- **⋯** has **Edit** and **Remove**. Removing deletes nothing: its chats go back in your list.
- Folders only sort chats; they don't change the answers.

### Many at once

Hold <kbd>mod</kbd> or <kbd>shift</kbd> and click chats, or choose **Select** from a chat's menu. The bar at the bottom offers **Pin**, **Move to**, **Archive** and **Delete**. **Done** or <kbd>esc</kbd> ends it.

### On a phone

- Swipe right to pin, left to archive. **Undo** puts it back.
- Hold a chat until it lifts, then drag it onto a folder, which says what letting go will do. Let go without moving for its menu.

### Tidy up

Once eight or more chats are a month untouched, a note at the end of the list offers **Archive them**. It skips chats that are pinned, in a folder, working, waiting for you or new. **Undo** brings them back. **Not now** hides the note until ten more pile up.

<kbd>alt+up</kbd> and <kbd>alt+down</kbd> go to the chat above or below. Double-click a title to rename it.

## Search

<kbd>mod+k</kbd> searches chats and messages. See [Find](./find.md).

## Writing a message

<kbd>enter</kbd> sends, <kbd>shift+enter</kbd> starts a new line. Type anywhere in the chat and it goes in the message box.

- <kbd>↑</kbd> in an empty box brings back what you sent, newest first: this chat, then other recent chats. <kbd>↓</kbd> goes forward.
- **Copy**, on a message of yours, takes its words.
- Type `/` for [commands](../reference/slash-commands.md): the model, how hard it thinks, a goal, a plan and more.

### Drafts

What you don't send stays in that chat: words, attached files and pictures, long pastes. The new chat page keeps one too, with the model and mode you chose.

- It survives reloads and restarts, and Conch keeps it, not the browser, so it's on your phone too.
- Chats with a draft show a pencil and **Draft** in your list.
- Sending clears it. Deleting the chat deletes its draft and files.
- Signing out clears only this device's copy.
- A draft untouched for 30 days goes, with its files. A missing file's card says **No longer here**: remove it and attach it again.

## Who answers

A chat starts with your default [agent](./agents.md), named by **Talking to** above the message box. Press it to choose another before the first message. Later, press **‹name› answers this chat** at the top, or type `/agent` and a name.

The new agent answers from your next message, marked by a line like **Atlas took over from Juniper**. Each answer shows its agent's face and name.

### Ask for another model

Say it in the chat: "use Opus 5.5", "try this with GPT", "use my Claude plan", "a cheaper one", "go back to Codex". Your assistant switches the chat to a model you connected, on any provider.

- **One line says so:** **Switched to Opus 5.5 on your Claude Max plan**. Press **Switch back** to return.
- **The request carries on.** "Try this with GPT" is answered by GPT, with the whole chat so far.
- **Several fit?** They show as buttons under the reply. A tap switches.
- **Not connected?** It says so, and offers to connect the provider. Once connected, the chat switches and carries on.
- **It doesn't spend on a guess.** Asked for "stronger", it picks among your plans first. A model you pay per reply is used when you name it or tap it.
- **Only this chat changes.** New chats still start with your default.

## While it works

<kbd>esc</kbd> or the stop button stops the reply at once, marked **Stopped** with how long it ran.

The words above the reply say what it's doing, with this step's time and what it has written so far (**12s · 42.3k tokens**).

- A long reply ends with **Worked 12m · 412k tokens** among its buttons.
- Press the ring beside the **Model · Mode** chip mid-reply to see what it has written and read so far.

### Long jobs

A message you're watching has no limit on steps, time or reading. Your assistant stops only when plainly stuck, repeating the same step with the same answer. Slow waits, failing tests and empty searches don't count. It's warned twice and tries another way first, then pauses with one sentence saying why. Press **Carry on**, or say what to do differently.

**To have it check in sooner**, turn on **Pause long turns to check in** in **Settings → Usage → Limits**:

- Set steps (from 100), minutes (30) and **Tokens used, in millions** (2, uncached reading and writing). It pauses at the first one reached.
- Over your [monthly budget](../care/offline.md) it checks in sooner still, but never stops you.

Routines and background tasks always get 200 steps and an hour.

### Queue your next message

Press <kbd>enter</kbd> while it works and the message waits above the box, then goes when the reply is over. More go in order.

- **Drag** one by its handle to reorder, or focus the handle and use the arrow keys.
- **Steer** (the lightning) sends one now: the reply stops, nothing is lost, and it reads your message next. <kbd>mod+enter</kbd> steers with what's in the box. Works with every provider.
- The pencil takes one back into the box. The cross drops it.
- If the reply stops or fails, the queue waits and each message offers to send now.

## What it did, in plain words

The chat tells an answer's steps in a few short lines, like **Ran the tests · 241 passed**, with a picture for the kind of work and icons for sites visited. Under a running line, the current step shows, in italics when a provider wrote it.

- **Press a line** for its steps, each with what it found and how long it took.
- **Press a step** for exactly what ran: the command, what came back, the change made. Nothing is hidden, only folded.
- **Why?** beside a step asks why your assistant did it and what it learned. Asking again costs nothing.

Repeats show once, with **×2** or a count. Retries say so ("Worked on the second try", "The same command failed 3 times").

**Better words.** When a part is done, a small model may rewrite its line; **Why?** uses it too. It follows the rules of [learning by itself](./memory.md#learning-by-itself):

- It asks the chat's own provider's smallest model first, then another connected provider with room, then one on this computer.
- A chat marked **Don't learn from this chat** uses only its own provider or one on this computer.
- If none has room, **Why?** says so and names the plan.
- On pay-as-you-go, each costs a fraction of a cent toward **Learning from your chats** in **Settings → Usage → Limits**, and stops at your [budget for the month](../care/what-it-costs.md#a-budget-for-the-month).

To keep the lines as they are, turn off **Name new chats automatically** in **Settings → General**. That also stops Claude Code describing its own steps (a small call per round).

### What changed

A reply ends with one line on what it changed outside the chat: **Changed 4 files · committed · pushed to main**. Press it for each change, messages sent, money spent and things deleted first. File changes have **Undo**, then **Redo**, as in [Undo](../care/undo.md).

### While you were away

If two or more parts finish while you're elsewhere, a **While you were away** card says how long it worked, with a line per part to jump to. The card goes when you press **Dismiss**, send a message, or read to the end.

### Site icons

Conch fetches each icon from the site itself, so no other company learns where you go; without one, the first letter shows. [Passwords](./passwords.md) never show site icons.

## When it asks you something

When your assistant needs a choice, it asks with a card and the reply waits.

- Tap an answer. A single set of options sends as you choose; anything more has **Send**.
- Pick a day or **Pick a date**, a time or **Another time…**.
- **Something else…** lets you write your own, or type in the message box, which says **Answer above, or type it here**.
- **Skip** lets your assistant carry on with its best guess and say what it assumed.
- On a keyboard, <kbd>1</kbd> to <kbd>6</kbd> pick and <kbd>enter</kbd> sends.

Once answered, the card folds to one line. Stopping the reply, or Conch restarting, skips the question.

A waiting question shows in the sidebar and, with [notifications](../start/phone.md) on, on your phone. In **Talk**, your assistant reads it out and you answer aloud.

Routines, background tasks and [chat apps](../channels/index.md) never stop to ask; your assistant picks the sensible choice and says which.

## What to say next

Under the latest reply, up to three buttons hold what you might say next, like “Make it shorter”. Press one to send it as written.

- **Your assistant** offers them when the next step is clear.
- **Conch** reads the reply. Under a table of numbers, **Show it as a chart** draws it beside the chat.

They go once anything newer arrives, and never show:

- while something in that reply waits for you;
- from your assistant after the chat read a web page, email or other outside words (Conch's own still show);
- in [routines](./routines.md), background tasks or [chat apps](../channels/index.md).

## Rename

Choose **Rename**, type and press <kbd>enter</kbd>. <kbd>esc</kbd> keeps the old title. Conch never replaces a title you wrote.

## Archive

**Archive** takes a chat out of your list without deleting it. [Search](./find.md) still finds it.

- Archiving the chat you're reading opens a new one. **Undo**, in the note, puts it back.
- A working chat carries on, and it returns to your list when you write in it or it needs you.
- In <kbd>mod+k</kbd>, **Archive this chat** does the same.

## Find what you archived

**Archived**, at the end of the sidebar, shows how many and opens **Archived chats**, newest first. Or type "archived" in <kbd>mod+k</kbd>.

- Choose a chat to read it. A note at the top has **Unarchive**, which puts it back where it was.
- The bin deletes it, after asking.
- With many chats, a box finds one by name. **⋯** has **Unarchive all** and **Delete all…**.

## Delete

Choose **Delete**, from the list or **Archived chats**, and confirm. The chat and what was attached only to it leave Conch. What your assistant remembered from it stays in [memory](./memory.md), where you can forget it too.

## Its plan, as it works

For a job of a few steps, your assistant writes its plan into the reply as a checklist, ticking steps off. A long one has **Show all**.

When the reply ends, it folds to one line, like **Plan · 5 of 5 done**. Press it for the steps. A stopped reply keeps its plan as far as it got.

Claude Code and Codex keep their own plan, which Conch draws. A chat-only model has none.

### Read only

In **Read only** mode, your assistant looks around and plans but changes nothing. `/plan` turns it on or off; `/plan` and a task plans it straight away. The finished plan shows in full, with:

- **Start**: ends Read only and begins, in the chat's previous mode.
- **Keep planning**: stays in Read only and puts you in the message box to say what to change.

## A goal for the chat

Type `/goal` and what the chat is for: `/goal move the photos into the family library`. Your assistant keeps it in mind every reply, whichever model answers, and it survives clearing the chat.

It shows as a line above the message box. Press it to read it, **Edit** it or **Clear goal**.

## Start afresh

Type `/clear` for a fresh start in the same chat. A **Context cleared** line marks where, and your assistant reads nothing above it, with every provider.

Your messages and the goal stay. **Undo**, on the line or in the note, restores it until you send something. In <kbd>mod+k</kbd>, **Start afresh in this chat** does the same.

## Long chats

A chat can go on as long as you like, with any model. When it outgrows what the model reads at once, Conch summarises its start, and the model reads that instead of the oldest messages.

- A quiet line marks where: **Earlier messages are summarised for** and the model's name. Press it to read what the model keeps.
- Every message stays for you.
- Before summarising, Conch learns what you said there, as the [memory](./memory.md) tidy-up does.
- If the model still says it's too long, Conch summarises more and resends. If that fails, the chat offers a model that reads more, or a new chat.

**How full is it?** The ring beside the **Model · Mode** chip fills against your model's reading size (**35%**), amber at three quarters and red at nine tenths. Press it for the numbers and **Compact now**.

Type `/compact`, or press **Compact now**, to summarise the start now. Add what matters most and the summary keeps it: `/compact the garden plan`. In <kbd>mod+k</kbd>, **Summarise the start of this chat** does the same. Claude Code and Codex keep their own memory of the chat, so there `/compact` goes to them.

## Good to know

- Chats from your [chat apps](../channels/index.md) archive the same way. A new message from there brings the chat back.
- Routines, tasks and pinned apps keep their runs on their own pages, never in this list or the archive.
- Archiving, pins and folders are in your [backups](../care/backups.md).
- In <kbd>mod+k</kbd>, type a folder's name to open it, or **New chat in** and its name to start one there. Also **Pin this chat**, **Move this chat to…** and **New folder**.
