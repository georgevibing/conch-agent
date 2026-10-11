---
title: How it did it
description: Replay any chat, routine run or task step by step, and save it as a file to read or to train and test models with.
order: 12.7
---

**How it did it** puts a chat's steps on one timeline you can scrub and replay: what
you asked, what your assistant read, ran and changed, where it waited, and what each
reply cost. Routine runs and tasks have one too.

## Open it

- In a chat, press **How it did it** at the top, next to **Find in chat**.
- On a phone, press **More** (the three dots), then **How it did it**.
- Or <kbd>mod+k</kbd> and type "replay" or "timeline".

## Scrub and replay

The bar runs from your first message to the last reply. Each mark is a step: its colour is the kind of work (reading, changing files, running tests), a
diamond is a question it asked you, red means something didn't work. Long waits fold
into a short break.

- **Drag** along the bar, or use the arrow keys, for one step at a time; Page Up and
  Page Down jump a whole message.
- **Replay** plays it back, the pearl riding the bar.
- Below the bar: what the step did, how long it took and what it found. An edit shows
  the changed lines; a browser step shows the page as it was.
- **Show in chat** opens the chat there.

Above the bar: time, steps, tokens and money so far (**In all** at the end). New steps
appear live.

## Save it as a file

1. Choose what to save:
   - one chat: **Save it** at the bottom of its timeline;
   - many chats: **Save as a file** in **Settings → Activity**, or <kbd>mod+k</kbd> and **Save
     chats as a file**. Choose how far back and, if you have several, which agent or
     provider. Routine runs and tasks are included unless you turn off **Routines and
     tasks too**.
2. Under **Save it as**, choose a format:
   - **A page to read**: every step, as a web page that runs and loads nothing.
   - **Markdown**: the same, as plain text.
   - **OpenAI chat, for training**: messages and tool calls, one chat per line, as
     OpenAI's fine-tuning and many other tools take.
   - **ShareGPT, as Hermes writes it**: Hermes Agent's training format, with each tool
     call and result in the conversation.
   - **ATIF, for agent research**: Harbor's trajectory format, with numbered steps,
     tool calls, results, and tokens and cost per step.
3. Press **Save**. It goes to Downloads, or press **Change** for another folder.

A second copy gets " 2" on its name instead of replacing the first. Conch never sends
your chats anywhere.

## Keys and personal details come out

**Take out keys and personal details** is on for every save, and first shows what goes ("2 keys and tokens, 1 email address and 3 folder names"). Press that line
to see where each was, as it will be saved (`OPENAI_API_KEY=[key]`), without the values.

It takes out:

- the passwords and keys Conch keeps, and anything shaped like a key or token
- email addresses, phone numbers and card numbers
- addresses of computers on the internet
- your home folder's name
- your name and the names of people in [About you](./memory.md)

> [!WARNING]
> This catches what it recognises, not everything. Before you share a file, look for
> anything private, like a secret in an unusual shape or a name not in About you.

Turn it off only for a file you keep. It's back on next time.
