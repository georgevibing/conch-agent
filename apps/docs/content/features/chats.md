---
title: Your chats
description: Pin, file and tidy your chats, see which need you, choose who answers, queue messages, use / commands, set a goal, and keep a long chat going.
order: 12
---

Your chats are in the sidebar. Point at one and press **⋯**, or right-click it, for what you can do with it. On a phone, press and hold.

## Your list

From the top, the sidebar shows:

- **Apps.** App pages you pinned, as a row of app tiles under a quiet **Apps** heading. Each tile has its app's icon. Point at one to see where it's from, like "Page of the Tally app". Right-click a tile, or press and hold it, for **Unpin** and the app's details. The ones you open most are the ones in the row.
  With more apps than fit, the last tile is **All apps**: press it and every app opens as a folder, with a search. Type a few letters to find one, use the arrow keys to move between them, Enter to open, and Escape to close. **Open Apps** at its foot goes to the [Apps](apps.md) page.
- **Needs you.** Chats waiting for you to allow or answer something stay here until you do.
- **Pinned.** Chats you keep at the top.
- **Folders.** Your own groups of chats.
- **Everything else, by when.** Today, Yesterday, Previous 7 days, Previous 30 days, then one group per month.
- **Archived**, at the end.

You only see a part once there's something in it.

### What each chat is doing

A small mark beside a chat says what's happening in it:

- **The pearl:** it's working.
- **An amber dot:** it needs you.
- **A dot and a bolder title:** something new happened while you were elsewhere, like a reply that finished or a message from a [chat app](../channels/index.md). Open the chat and the mark goes, on your phone too.
- **A red dot:** the last reply didn't finish.

The menu beside **Chats** shows **All chats**, only what's **New**, or only chats **From chat apps**.

### Pin a chat

Choose **Pin** to keep a chat at the top. There's no limit. Drag pinned chats to put them in your own order, or use **Move up** and **Move down**. Archiving a chat unpins it.

### Folders

Choose **Move to → New folder…**. Give the folder a name, and pick a mark and a colour. Then:

- Drag chats onto a folder, or choose **Move to** and the folder. On a phone, hold a chat until it lifts, then drag it onto the folder.
- Press a folder's name to fold or unfold it.
- Press **✎** beside a folder's name to start a chat already inside it. The new chat page says where it's going, and the chat shows in the folder from the moment you send it. **✕** starts it outside the folder instead.
- Press **⋯** beside a folder to **Edit** or **Remove** it. Removing a folder puts its chats back in your list. It deletes nothing.

Folders only sort your chats. They don't change how your assistant answers.

### Many at once

Hold <kbd>mod</kbd> or <kbd>shift</kbd> and click chats to select them, or choose **Select** from a chat's menu. A bar at the bottom offers **Pin**, **Move to**, **Archive** and **Delete**. **Done** or <kbd>esc</kbd> ends it.

### On a phone

Swipe a chat to the right to pin it, or to the left to archive it. **Undo** puts it back.

Hold a chat for a moment and it lifts off the list. Keep your finger down and drag it onto a folder: folders light up as you pass over them and say what letting go will do, and the list scrolls by itself near its top and bottom. Let go on a folder and the chat moves there. Let go anywhere else and nothing changes. Let go without moving and you get the chat's menu, as before.

### Tidy up

Once a few chats haven't been touched for a month, a note at the end of the list offers **Archive them**. It leaves out anything pinned, in a folder, working, waiting for you or new. Nothing is archived until you press it, and **Undo** brings them back. **Not now** hides the note.

<kbd>alt+up</kbd> and <kbd>alt+down</kbd> go to the chat above or below. Double-click a title to rename it.

## Search

Press <kbd>mod+k</kbd> to search chats and messages. The search window stays the
same size as you type or move between results. Scroll the results and the preview
separately; the search box stays in place. On a narrow screen, only results are shown.

## Writing a message

<kbd>enter</kbd> sends and <kbd>shift+enter</kbd> starts a new line. You can start typing anywhere in the chat: the words go in the message box.

- <kbd>↑</kbd> in the empty box brings back what you sent, newest first: this chat's messages, then what you sent lately in other chats. <kbd>↓</kbd> walks forward again. Change it and send, or keep going.
- What you were writing stays in each chat when you go to another, and after a restart. Signing out on this device clears it.
- Point at a message of yours and press **Copy** to take its words.
- Type `/` for commands: change the model or how hard it thinks, start afresh, set a goal, plan first, copy the last reply, save the chat as a file and more. The list offers each command's choices, with the one in use ticked. [Every command](../reference/slash-commands.md).

## Who answers

A chat starts with your default [agent](./agents.md): **Talking to** its name, above the message box, says who. Press it to choose another before the first message. Later, press the name at the top of the chat (**‹name› answers this chat**), or type `/agent` and a name. The new agent answers from your next message, and a line marks where: **Atlas took over from Juniper**. Above each answer, a small line with the agent's face and name says who wrote it, and the words below take the chat's full width.

## While it works

<kbd>esc</kbd> or the stop button stops the reply. It ends there at once with a **Stopped** mark (and how long it ran), and you can write your next message straight away: if the provider is still winding down, it waits a moment and then goes.

While it works, the words above the reply say what it's doing after each step: reading a command's output, looking at a page, checking an edit. Beside them, a quiet tally: how long this step has taken, and what the reply has written so far, rolling up as it grows (**12s · 42.3k tokens**). The clock starts again with each step, so a long job reads step by step rather than as one big timer; each finished step keeps its own time on its row. Once a long reply is done, **Worked 12m · 412k tokens** among its buttons says what the whole of it took. The ring beside the mode picker keeps saying how full the chat is, and pressing it while a message runs shows what it has written and read so far.

### Long jobs

Your assistant can take as many steps as a job needs: booking something across a few websites, tidying a big folder. A message you're watching runs until it's done, with no limit on steps, time or reading. It only stops by itself when it's plainly getting nowhere: the very same step coming back with the very same answer, again and again in quick succession. Checking on something that takes a while, failing tests on the way to fixing them, or a search that finds nothing are all work, never a reason to stop. It's told first, twice, and tries another way; only if it carries on does it pause, with **Carry on** to pick up where it was.

The reply then ends with one sentence saying why it paused. Press **Carry on** and it picks up exactly where it stopped, with everything it had done. Or say what to do differently.

Want it to check in sooner? In **Settings → Usage → Long turns**, turn on **Pause long turns to check in** and set your own limits: steps (starts at 100), minutes (30) and fresh tokens in millions (2), meaning what a message reads and writes that the provider hadn't already cached. A chat then pauses at the first one it reaches, with **Carry on**. Over your [monthly budget](../care/offline.md), it checks in sooner still, but it never stops you.

Routines and background tasks have their own room (200 steps, an hour), since nobody is there to press **Carry on**. That doesn't change with the switch.

You don't have to wait to say what's next. Write it and press <kbd>enter</kbd>: it waits above the message box and goes by itself the moment the reply is over. Send more and each waits its turn, in order, one at a time: the next goes when the reply before it is done.

- **Drag** one by its handle to change the order (with a finger on a phone), or focus the handle and use the arrow keys.
- **Steer** (the lightning) sends one now: the reply stops where it is, nothing it did is lost, and it reads your message next. <kbd>mod+enter</kbd> steers with what's in the box. The rest keep waiting and carry on after. It works the same with every provider.
- The pencil takes one back into the box to change it, and the cross doesn't send it.
- If you stop the reply, or it fails, the queue waits for you instead of going on, and each one offers to send now.

## What it did, in plain words

Your assistant often takes many steps for one answer: it reads files, runs commands, looks at pages. The chat doesn't list them one by one. It tells them in a few short lines, each saying what that part of the work did and what it came to: **Ran the tests · 241 passed**, **Searched the web and read 3 pages**, **Pushed the fixes to main**. A small picture beside each line says what kind of work it was, and moves a little while the work goes on. The sites it looked at show their icons.

While a line is still going, the words under it say the step at hand, like "Reading the settings file". Some providers say this in their own words. Those are set in italics.

- **Press a line** to see its steps, each in plain words, with what it found and how long it took.
- **Press a step** to see exactly what ran: the command, what came back, the change made. Nothing is hidden, only folded away.
- **Why?** beside a step asks why your assistant did it and what it learned. The answer takes a moment and comes from what's in the chat. Your assistant keeps working meanwhile. Asking again about a finished step costs nothing.

When a step is done again with the same result and nothing changed in between, it shows once: a line of one step says **×2**, and an opened line says how many repeats it folded. When something failed and then worked, the line says so: "Worked on the second try". When your assistant is going round in circles, the line says that too, like "The same command failed 3 times", so you can step in.

Once a part of the work is done, a small model may rewrite its line in better words. **Why?** asks it too. It follows the rules of [learning by itself](./memory.md#learning-by-itself). It asks the chat's own provider first, on its smallest model. If that plan is nearly used up, it asks another provider you connected that has room, then one on this computer. A chat marked **Don't learn from this chat** only goes to its own provider or one on this computer. Only when none has room does **Why?** say so, and it names the plan. Each answer costs a fraction of a cent on pay-as-you-go providers. It counts toward **Learning from your chats** in **Settings → Usage**, and stops when your [budget for the month](../care/what-it-costs.md#a-budget-for-the-month) is spent. To keep the lines as they are, turn off **Name new chats automatically** in **Settings → Models**. That also stops Claude Code describing its steps in its own words, which costs a small call on your plan for each round of steps.

### What changed

At the end of a reply, one line sums up what it changed outside the chat: **Changed 4 files · committed · pushed to main**. Press it to see each change. Messages sent, money spent and things deleted come first. A change to your files has **Undo** beside it, and then **Redo**, as in [Undo](../care/undo.md).

### While you were away

If you switch to another chat or another app while your assistant works, and two or more parts of the work finish meanwhile, a card at the top of the chat says **While you were away**: how long it worked, and one line for each part. Press a line to go to it in the chat, opened. The card goes when you close it with **Dismiss**, send a message, or read down to the end.

### Site icons

The icons of the sites your assistant visited come through Conch. Conch asks each site for its own icon, so no other company learns which sites you visit. A site without one shows its first letter. [Passwords](./passwords.md) never show site icons, so no site learns you have an account there.

## When it asks you something

Sometimes your assistant needs your choice before it can go on: which day suits you, how you'd like to talk, how many people are coming. It asks with a card in the chat, and the reply waits for you.

- Tap an answer. A question with one set of options goes as soon as you choose. Anything more has **Send**.
- Pick a day from the row of days, or **Pick a date** for another. On a phone the row slides sideways for more days.
- Pick a time from the few it suggests, or **Another time…** for any other. Numbers and a few words work the same way.
- **Something else…** lets you write your own answer.
- Or type your answer in the message box. While a question waits, it says **Answer above, or type it here**.
- **Skip** lets your assistant carry on with its best guess. It tells you what it assumed.

On a keyboard, <kbd>1</kbd> to <kbd>6</kbd> choose an option and <kbd>enter</kbd> sends.

Once you answer, the card folds to one line with your answer. Stopping the reply skips the question, and so does Conch restarting while it waits.

A waiting question shows in the sidebar like anything else that needs you. With [notifications](../start/phone.md) on, your phone hears that your assistant has a question. In **Talk**, your assistant reads the question out, and what you say back answers it.

Routines, background tasks and chats from your [chat apps](../channels/index.md) never stop to ask, because nobody is there to answer. Your assistant picks the sensible choice and says which.

## What to say next

Under the latest reply, up to three small buttons hold what you might well say next: “Make it shorter”, “Add Ada to the invite”. Press one and it's sent, exactly as it reads, as if you'd typed it. The chat's model and settings stay as they are, and anything you were writing in the message box stays there.

They come from two places:

- **Your assistant** offers them when the next step is clear. Most replies have none.
- **Conch** reads the reply itself. Under a table of numbers, **Show it as a chart** draws it beside the chat.

They go as soon as anything newer is in the chat: a message from you, here or on another device, or a new reply. You'll never see them:

- while something else is waiting for you in that reply, like a question or a card to connect an app, so there's one thing at a time;
- from your assistant after the chat has read something from outside, like a web page or an email, because those words could be someone else's (Conch's own still show);
- in [routines](./routines.md), background tasks or chats from your [chat apps](../channels/index.md), where nobody is there to press them.

## Rename

Choose **Rename**, type the new title and press <kbd>enter</kbd>. <kbd>esc</kbd> keeps the old one. A title you write is never replaced by the one Conch suggests.

## Archive

Choose **Archive** to take a chat out of your list without deleting it. Nothing in it changes, and it still turns up when you [search](./find.md).

- Archiving the chat you're reading takes you to a new chat.
- **Undo**, in the note that appears, puts it straight back.
- A chat that's still working carries on in the archive.
- An archived chat comes back to your list by itself when you write in it, or when it needs you to allow or answer something.

In <kbd>mod+k</kbd>, **Archive this chat** does the same for the chat you're in.

## Find what you archived

**Archived**, after the last chat in the sidebar, shows how many chats are in the archive. It opens **Archived chats**, most recently archived first. You can also type "archived" in <kbd>mod+k</kbd>.

From there:

- Choose a chat to read it. A note at the top says it's archived, with **Unarchive**.
- **Unarchive** puts a chat back in your list, where it was.
- The bin deletes it, after asking.
- With many chats, a box finds one by name. **⋯** has **Unarchive all** and **Delete all…**.

## Delete

Choose **Delete**, from the list or from **Archived chats**, and confirm. The chat and what was attached only to it are removed from Conch. Anything your assistant remembered from it stays in [memory](./memory.md), where you can forget it too.

## Its plan, as it works

When something takes a few steps, like tidying a folder or fixing a bug, your assistant writes its plan into the reply as a short checklist. You see where it's up to while it works: finished steps get a tick, the one it's doing now shows what it's doing (“Running the tests”), and the rest wait their turn. A long plan shows the steps around the work, with **Show all** for the rest.

When the reply ends, the plan folds to one line, like **Plan · 5 of 5 done**. Press it to see the steps again. A reply you stopped keeps its plan as far as it got.

Claude Code and Codex keep a plan of their own, and Conch draws it. Other providers that can use Conch's tools get the same checklist. A model that can only chat doesn't keep one.

### Read only

In **Read only** mode, your assistant looks around and plans, but changes nothing. Type `/plan` to turn it on or off, or `/plan` and what you'd like done to plan it straight away. When the plan is ready it's shown to you in full, with two buttons:

- **Start** ends Read only and begins the work, in the mode the chat had before.
- **Keep planning** stays in Read only, and puts you back in the message box to say what to change.

This works with every provider that can use Conch's tools: Claude Code asks with its own plan, and the others ask through Conch, with the same card.

## A goal for the chat

Type `/goal` and what the chat is for: `/goal move the photos into the family library`. Your assistant keeps it in mind in every reply, whichever model answers, and the goal stays when you clear the chat. It shows as one quiet line above the message box. Press it to see it whole, **Edit** it or **Clear goal**. A line in the chat marks where it was set.

## Start afresh

Type `/clear` when a chat has wandered and you'd like your assistant to start over in the same place. A line marks where: **Context cleared**. From there on it reads nothing said above, with every provider. Every message stays for you, and so does the goal. **Undo**, on the line or in the note, puts it back until you send something new. In <kbd>mod+k</kbd>, **Start afresh in this chat** does the same.

## Long chats

A chat can go on as long as you like, with any model. Each model reads only so much at once, so when a chat grows past that, Conch writes a short summary of its start. The model reads the summary instead of the oldest messages, and carries on.

- A quiet line in the chat shows where the summary starts: **Earlier messages are summarised for** the model's name. Press it to read exactly what the model keeps.
- Every message stays in the chat for you. Only what the model reads gets shorter.
- Before the start of a chat is summarised, Conch learns what you said there, as the [memory](./memory.md) tidy-up does.
- If the model still says the chat is too long, Conch summarises more and sends your message again by itself. Only if that isn't enough does the chat offer a model that reads more at once, or a new chat.

**How full is it?** The ring beside the mode picker fills as the chat grows, with the share beside it (**35%**). It measures against the model you chose: a model that reads a million tokens fills ten times slower than one that reads 100k. It turns amber from three quarters and red from nine tenths. Press it to see how much the model reads each time, out of how much, and **Compact now**.

Type `/compact`, or press **Compact now**, to summarise the start now. Add what matters most to you, and the summary keeps it: `/compact the garden plan`. In <kbd>mod+k</kbd>, **Summarise the start of this chat** does the same. Claude Code and Codex keep their own memory of the chat, so there `/compact` goes to them, and they summarise it their own way.

## Good to know

- Chats from your [chat apps](../channels/index.md) archive the same way. A new message from there brings the chat back.
- Routines, tasks and pinned apps keep their runs on their own pages, so they're never in this list or the archive.
- Archiving, pins and folders are kept with your chats, so they're in your [backups](../care/backups.md) too.
- In <kbd>mod+k</kbd>, type a folder's name to open it, or **New chat in** and its name to start one inside it; or **Pin this chat**, **Move this chat to…** or **New folder**.
