---
title: Find anything
description: One box finds every chat, any line you half remember, and every skill, model, app and setting by name.
order: 11
---

Press <kbd>mod+k</kbd>, or **Search** in the sidebar, and type. One box searches chat
titles, every message, and everything in Conch with a name. Typos are fine.

## What it finds

Results arrive in groups:

- **Chats**, by title: "pmw" finds "Plan my week". [Archived](./chats.md#archive) ones
  too, marked.
- **Messages** from any chat: your words, the answers, the questions your assistant asked
  on a card with what you chose, and the commands and files your assistant worked with.
- **Agents**, **Skills**, **Skills people share**, **Models**, **Apps** (or
  "integrations"), **Talk to me here** (or "channels"), **Folders**, **Routines**,
  **Passwords**, **Tasks** and **Made for you**, by name.
- **Go to**: every page, every place in Settings (old names too, such as **Appearance**
  or **Devices**), and actions such as **Back up now** or **Repair everything**.

Empty, it shows recent chats (not archived) and common actions.

## What choosing does

Arrow keys and <kbd>enter</kbd>:

- A chat opens; a message opens its chat at that line, with every match lit.
- An agent answers this chat from your next message; **New chat with** starts a fresh
  one.
- A skill goes into the message box as `/name`. A shared skill opens in **Discover**.
- A model is used for this chat.
- A folder opens, or takes a new chat or this one.
- A routine, password or connected app opens; an unconnected app opens its connect step.
- A setting opens Settings at that place.

On a wide screen, a preview shows the chat or message beside the list; on a narrow one, only results. The window keeps its size as you type, and the results and preview scroll separately.

## A line you half remember

- Part of a word is enough: "deplo" finds "redeployed". Capitals and accents don't matter.
- "Quotes" match an exact phrase.
- With no exact match, Conch shows **Close matches**.
- Messages need three letters; fewer search titles and names only.

## By meaning

With the meaning model from [Memory](./memory.md#search-that-understands), messages are
found by what they're about too: "our honeymoon" finds "the trip to Bali". Chats with
your words come first.

- Conch reads your chats into it in the background, newest first, and pauses while your
  computer is busy. Until it's done, search finds what it has, and words always work.
- **Settings → Health** shows how far it is under **Search by meaning**.
- In the chat you're reading, <kbd>mod+f</kbd> matches words only.

## In the chat you're reading

<kbd>mod+f</kbd> highlights every match in the open chat, with marks along the
scrollbar. <kbd>enter</kbd> goes to the next, <kbd>esc</kbd> closes. In
<kbd>mod+k</kbd>, the list also offers to find your words in this chat. Other keys are
in [Keyboard shortcuts](../reference/keyboard.md).

## What your assistant did

**Find in activity**, in **Settings → Activity**, searches everything your assistant did in every
chat and routine, not only what's on screen. `gpush` finds "git push", and a chat's
name finds what happened in it.

## Good to know

- Search runs on Conch's computer, with no outside service.
- Your assistant searches your chats the same way when you mention one. See
  [Memory](./memory.md#your-earlier-chats).
- [Past chats you brought in](../care/past-chats.md) are found too and open beside
  where you are.
- The index, and what search by meaning keeps, are rebuilt from your chats whenever
  they're missing, so they're left out of [backups](../care/backups.md).
- If search breaks, the box offers **Repair search**.
