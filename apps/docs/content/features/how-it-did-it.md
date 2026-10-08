---
title: How it did it
description: Replay any chat, routine run or task step by step, and save it as a file to read or to train and test models with.
order: 12.7
---

Every chat keeps its steps: what you asked, what your assistant read, ran and changed, where it waited for you, and what each reply cost. **How it did it** puts them on one timeline you can scrub through and replay. Routine runs and tasks have one too, so you can see what happened while you weren't watching.

## Open it

- In a chat, press the **How it did it** button at the top, next to **Find in chat**.
- On a phone, press **More** (the three dots), then **How it did it**.
- Or press <kbd>mod+k</kbd> and type "replay" or "timeline".

A routine's run and a task open as their own chat, so the same button works there.

## Scrub and replay

The bar across the top is the run, from your first message to the last reply. Each mark is a step. Its colour shows the kind of work, like reading, changing files or running tests. A diamond is a question it asked you, and red means something didn't work. Long waits, like the time between your messages, fold into a short break so the work itself stays readable.

- **Drag** along the bar, or use the arrow keys to go one step at a time. Page Up and Page Down jump a whole message at a time.
- **Replay** plays it back one step at a time, with the pearl riding along the bar.
- Below the bar is the step you're on: what it did, how long it took, and what it found. An edit shows the lines it changed, and a browser step shows the page as it was.
- **Show in chat** closes the timeline and opens the chat right at that step.

The line above the bar adds up the work up to the step you're on: time spent, steps, tokens and money. At the end it says **In all**. While your assistant is still working, new steps appear as they happen.

## Save it as a file

Press **Save it** at the bottom of the timeline to save that chat. To save many chats at once, press **Save as a file** on the **Activity** page (in the sidebar), or <kbd>mod+k</kbd> and **Save chats as a file**. Then choose how far back to go and, if you have more than one, which agent or provider. Routine runs and tasks are included unless you turn off **Routines and tasks too**.

Choose what to save it as:

- **A page to read**: every step with what it found, as a web page that opens in any browser. It runs nothing and loads nothing from the internet.
- **Markdown**: the same, as plain text for notes and documents.
- **OpenAI chat, for training**: the messages and tool calls, one chat per line. This is the format OpenAI's fine-tuning and many other training tools take.
- **ShareGPT, as Hermes writes it**: the format Hermes Agent saves for training, with each tool call and its result written into the conversation.
- **ATIF, for agent research**: Harbor's trajectory format, with numbered steps, tool calls and their results, and tokens and cost for each step.

Press **Save**. The file goes into your Downloads folder, or press **Change** to choose another folder. It never replaces a file that's already there: a second copy gets " 2" at the end of its name. It stays on this computer, because Conch never sends your chats anywhere.

## Keys and personal details come out

**Take out keys and personal details** is on whenever you save. Before you save, Conch shows what it will take out, like "2 keys and tokens, 1 email address and 3 folder names". Press that line to see where each one was, written as it will be saved (`OPENAI_API_KEY=[key]`). The values themselves aren't shown there.

It takes out:

- the passwords and keys Conch keeps
- anything shaped like a key or token
- email addresses, phone numbers and card numbers
- addresses of computers on the internet
- your home folder's name
- your name and the names of the people in [About you](./memory.md)

> [!WARNING]
> This catches what it can recognise, not everything. Before you share a file, look through it for anything private, like a secret in an unusual shape, or a name you never added to About you.

Turn the switch off only for a file you keep for yourself. The next time you save, it's on again.
