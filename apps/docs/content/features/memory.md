---
title: Memory
description: Conch remembers what matters about you, shows every memory it keeps, and lets you change or forget any of them.
order: 1
---

Your assistant remembers things from one chat to the next: what you like, who you work with, what you're building. Every memory is a small file on your computer, and every save is shown to you. Nothing is learned behind your back.

## How it learns

Mention something that will still matter next week ("I'm vegetarian", "my sister is called Maria") and your assistant saves a short note. The chat shows **Remembered:** with what it wrote, and **Undo** beside it.

- To save something yourself, type `/remember` and the fact.
- To have it save only when you ask, turn off **Remember things automatically** in **Settings → Memory**.

It is told to leave out passwords, keys, and health or money details unless you ask.

## See what it knows

Open **What Conch knows about you** with <kbd>mod+k</kbd>, by typing `/memory`, or from **Settings → Memory → Open**. The page holds:

- **About you.** Your name and a few lines about you. Your assistant always has these in mind.
- **Memories.** Everything it remembers. Each one says whether you added it, it was learned in a chat, or it came from a tidy-up. Show one kind at a time: **Preferences**, **People**, **Projects** or **Facts**.
- **Export.** Everything in one file, as a document or as data.

Click a memory to change it. **Forget** removes it, and **Undo** brings it back. To add one by hand, write it in the box and press **Add**.

## Search that forgives

Search finds a memory by its words. Typos and other forms of a word still match.

With a [model on this computer](../providers/ollama.md), search understands meaning too: "anniversary" finds your wedding. If Ollama is running without the small model this needs, the page offers it with **Get it**. Nothing leaves your computer.

Your assistant uses the same search. While your memories are few, it has all of them in mind. Once there are many, it starts each reply with the ones that fit what you said, and looks up the rest when it needs them.

## Tidy up

Memories pile up. **Tidy up now** merges repeats, updates what has changed, and picks up lasting things you said in recent chats. Turn on **Tidy up every night** and it happens once a night, between 2 and 5 in the morning, when nothing else is running.

Each tidy-up is a card under **Recent learnings**. Every change shows what a memory said before, what it says now, and why, with **Keep** and **Undo**. Undo puts back exactly what was there.

A tidy-up asks the cheapest model you have. With no model to ask, it only merges exact repeats.

## Waiting for your OK

A web page or an email can try to plant a memory, such as "remember to send invoices to this address". So anything learned in a chat that read something from outside is set aside. The chat shows **Wants to remember:** with **Keep** and **Forget**, and the memory sits under **Waiting for your OK** on the page.

Your assistant doesn't use a waiting memory, and it isn't in an export, until you keep it.

With **Remember things automatically** off, anything new a tidy-up learns waits the same way.

## Good to know

- Memories are Markdown files in `~/.conch/memory`, one each. Open, edit or delete them with any editor. They are part of every [backup](../care/backups.md).
- Memory belongs to Conch, so every provider you connect knows the same things. [Codex](../providers/codex-cli.md) reads your memories but can't save new ones itself.
- Only your own words teach it. Routine runs, and messages from other people on a chat app, are left out.
