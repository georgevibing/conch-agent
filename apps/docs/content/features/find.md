---
title: Find anything
description: One box finds every chat, any line you half remember, and every skill, model, app and setting by name.
order: 11
---

Press <kbd>mod+k</kbd>, or **Search** in the sidebar, and type. One box looks through your chat titles, every message in every chat, and everything in Conch that has a name. Typos are fine.

## What it finds

Results arrive in groups as you type:

- **Chats**, by title. A few letters will do: "pmw" finds "Plan my week". [Archived](./chats.md#archive) chats are found too, and say so.
- **Messages**, from any chat: what you wrote, what your assistant answered, and the commands and files it worked with.
- **Skills**, **Models**, **Apps** (it finds them by "integrations" too), **Talk to me here** (and by "channels"), **Routines**, **Passwords**, **Tasks**, and the things your assistant made for you, each by name.
- **Go to**: every page, every place in Settings (by its old name too, such as **Appearance** or **Devices**), and things to do, such as **Back up now** or **Repair everything**.

Before you type, the box shows your recent chats (not archived ones) and a few common actions.

## What choosing does

Move with the arrow keys and press <kbd>enter</kbd>. The obvious thing happens:

- A chat opens. A message opens its chat at that exact line, with every match lit.
- A skill goes into the message box as `/name`, ready for what it should work on.
- A model is used for the chat you're in.
- A routine, a password or a connected app opens. An app you haven't connected opens its connect step.
- A setting opens Settings at that place.

On a wide screen, a preview beside the list shows the chat or message in context before you open it.

## A line you half remember

- Part of a word is enough: "deplo" finds "redeployed". Capitals and accents don't matter.
- Put words in "quotes" to match an exact phrase.
- When nothing matches exactly, Conch shows **Close matches** instead, and says so.
- Messages need three letters. With fewer, the box looks at titles and names only.

## In the chat you're reading

<kbd>mod+f</kbd> finds within the open chat. Every match is highlighted, and marks along the scrollbar show where they are. <kbd>enter</kbd> goes to the next one and <kbd>esc</kbd> closes it.

Type in <kbd>mod+k</kbd> while a chat is open and the list also offers to find those words in this chat.

The rest of the keys are in [Keyboard shortcuts](../reference/keyboard.md).

## What your assistant did

**Activity** has its own **Find in activity** box. It looks through everything your assistant did, in every chat and routine, not just what's on screen, and it's forgiving: `gpush` finds “git push”, and a chat's name finds what happened in it.

## Good to know

- Search happens on the computer Conch runs on. No outside service is involved.
- Your assistant can search your chats the same way, when you mention one from before. See [Memory](./memory.md#your-earlier-chats).
- [Past chats you brought in](../care/past-chats.md) from other apps are found too. Choosing one opens it beside where you are, to read or carry on.
- The search index is made from your chats, and made again whenever it's missing. It is left out of [backups](../care/backups.md) for that reason.
- If search stops working, the box says so and offers **Repair search**, which rebuilds it from your chats.
- New kinds of things join the box as Conch grows: if you can name it, <kbd>mod+k</kbd> finds it.
