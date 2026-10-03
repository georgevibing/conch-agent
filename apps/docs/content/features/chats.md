---
title: Your chats
description: Answer its questions with a tap, send what to say next, rename, archive, find or delete a chat, and keep a long one going.
order: 12
---

Your chats are in the sidebar, newest first, grouped by day. Point at one and press **⋯** for what you can do with it.

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

### Plan only

In **Plan only** mode, your assistant looks around and plans, but changes nothing. With Claude Code, when the plan is ready it's shown to you in full, with two buttons:

- **Start** begins the work.
- **Keep planning** stays in plan mode, and puts you back in the message box to say what to change.

## Long chats

A chat can go on as long as you like, with any model. Each model reads only so much at once, so when a chat grows past that, Conch writes a short summary of its start. The model reads the summary instead of the oldest messages, and carries on.

- A quiet line in the chat shows where the summary starts: **Earlier messages are summarised for** the model's name. Press it to read exactly what the model keeps.
- Every message stays in the chat for you. Only what the model reads gets shorter.
- Before the start of a chat is summarised, Conch learns what you said there, as the [memory](./memory.md) tidy-up does.
- If the model still says the chat is too long, Conch summarises more and sends your message again by itself. Only if that isn't enough does the chat offer a model that reads more at once, or a new chat.

Type `/compact` to summarise the start now. Add what matters most to you, and the summary keeps it: `/compact the garden plan`. In <kbd>mod+k</kbd>, **Summarise the start of this chat** does the same. Claude Code and Codex summarise long chats themselves, so there `/compact` is theirs.

## Good to know

- Chats from your [chat apps](../channels/index.md) archive the same way. A new message from there brings the chat back.
- Routines, tasks and pinned apps keep their runs on their own pages, so they're never in this list or the archive.
- Archiving is kept with the chat, so it's in your [backups](../care/backups.md) too.
