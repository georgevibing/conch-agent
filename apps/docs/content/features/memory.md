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

Open **What Conch knows about you** with <kbd>mod+k</kbd>, by typing `/memory`, or from **Settings → Memory → Open**. It opens inside Settings, and **‹ Memory** goes back to the memory settings. The page holds:

- **About you.** Your name and a few lines about you. Your assistant always has these in mind.
- **Memories.** Everything it remembers. Each one says whether you added it, it was learned in a chat, or it came from a tidy-up. Show one kind at a time: **Preferences**, **People**, **Projects** or **Facts**.
- **Export.** Everything in one file, as a document or as data.

Click a memory to change it. **Forget** removes it, and **Undo** brings it back. To add one by hand, write it in the box and press **Add**.

## Search that understands

Search finds a memory by its words. Typos and other forms of a word still match, and so do a few everyday ideas: "my car" finds "Drives a red vehicle".

To have search understand meaning, press **Get it** on the page, or choose **Search memories by meaning** with <kbd>mod+k</kbd>. Conch downloads a small model once (23 MB, or 136 MB if you use a language other than English) and runs it on this computer, even offline. Then "anniversary" finds your wedding, and "which city is home" finds where you live. Nothing you've told Conch leaves your computer.

If the download stops, Conch tries again by itself; if it still can't, the page says why, with **Try again**. Already have an embedding model in [Ollama](../providers/ollama.md)? Search uses that one instead, and there's nothing to download.

Your assistant uses the same search. While your memories are few, it has all of them in mind. Once there are many, it starts each reply with the ones that fit what you said, and looks up the rest when it needs them.

## Your earlier chats

Memories hold facts about you. Your chats hold everything else: the plan you made, the venue you picked, the command that fixed the build. Your assistant can look through them too.

Say "like last time", "the Lisbon plan" or "what did we decide about the venue?" and it searches your other chats, the same way [Find anything](./find.md) does, then reads around the line it needs. The chat shows **Looked through your chats** with what it looked for. Open it to see each chat and line it found; choose one to go there.

- It finds [archived](./chats.md#archive) chats too, and knows they're archived. The chat you're in is left out.
- **Activity** lists every time it looked, beside what it remembered.
- It never passes on a password or a key. Anything Passwords handed out, and anything shaped like a key or written as "password: …", comes back as •••.
- A chat that read a web page or an email, or has someone else's words, could be trying to steer it. Reading one marks your chat the same way, so anything risky asks first. See [when the assistant reads something untrusted](../security/signing-in.md#when-the-assistant-reads-something-untrusted).
- Someone you let in on a chat app can't use it. Their chat with your assistant never sees yours, and neither does a chat with a message you forwarded in. **New chat** starts one that can.
- Routines and work sent to the background don't look back.

## Tidy up

Memories pile up. **Tidy up now** merges repeats, updates what has changed, and picks up lasting things you said in recent chats. Turn on **Tidy up every night** and it happens once a night, between 2 and 5 in the morning, when nothing else is running.

Each tidy-up is a card under **Recent learnings**. Every change shows what a memory said before, what it says now, and why, with **Keep** and **Undo**. Undo puts back exactly what was there.

A tidy-up asks the cheapest model you have. With no model to ask, it only merges exact repeats.

When a long chat is [summarised](./chats.md#long-chats), Conch first learns what you said in the part being summarised, by the same rules. That's a card under **Recent learnings** too, and the nightly tidy-up doesn't read those words again.

## Remembered, and said so

When your assistant remembers something, the chat says so in one quiet line, **Remembered**, with **Undo** beside it. It doesn't stop to ask.

A web page or an email can try to plant a memory, such as "remember to send invoices to this address". So a memory learned in a chat that read something from outside notes where it came from, on the page. Read the line when it appears; **Undo** takes it away.

## Waiting for your OK

When nobody is there to see it — a routine running by itself, or a chat where someone else is talking to your assistant on a chat app — a memory from a chat that read something from outside is set aside instead. It shows **Wants to remember** with **Keep** and **Forget**, and sits under **Waiting for your OK** on the page. Your assistant doesn't use a waiting memory, and it isn't in an export, until you keep it.

What you choose stays in the chat: open it again and it shows what you kept or undid.

With **Remember things automatically** off, anything new a tidy-up learns waits the same way.

## Good to know

- Memories are Markdown files in `~/.conch/memory`, one each. Open, edit or delete them with any editor. They are part of every [backup](../care/backups.md).
- The model for meaning isn't in backups: on a new computer, press **Get it** again. **Repair everything** notices if any of it goes missing and gets it back.
- Memory belongs to Conch, so every provider you connect knows the same things. [Codex](../providers/codex-cli.md) reads your memories but can't save new ones itself.
- Only your own words teach it. Routine runs, and messages from other people on a chat app, are left out.
