---
title: Memory
description: Conch remembers what matters about you, shows every memory it keeps, and lets you change or forget any of them.
order: 1
---

Your assistant remembers things from one chat to the next: what you like, who you work with, what you're building, how you correct it. It learns and tidies quietly, without asking. It only stops to ask when a memory looks unsafe. Every memory is a small file on your computer, and you can see, change or forget any of them. All your [agents](./agents.md) share it.

## How it learns

Mention something that will still matter next week ("I'm vegetarian", "my sister is called Maria") and your assistant saves a short note. The chat shows **Remembered:** with what it wrote, and **Undo** beside it.

- To save something yourself, type `/remember` and the fact.
- To have it remember only what you ask, turn off **Learn from your chats** in **Settings → Memory**.

It is told to leave out passwords, keys, and health or money details unless you ask.

## Learning by itself

Some things only show once a chat is over: you corrected it ("no, I meant TypeScript"), you said something changed ("I moved to Lisbon"), or a command needed another program on this computer. So once a chat has been quiet for a few minutes, Conch reads your words in it once more and keeps what will still matter.

- **It doesn't interrupt.** Nothing appears in the chat. What it learned is on **What Conch knows about you**, where you can change or forget it.
- **What changed replaces what was.** "Lives in Lisbon" replaces "Lives in Berlin". The old memory is kept under **What used to be true**, with the date it stopped being true, so your assistant can still answer questions about before.
- **What you take back stays back.** A memory Conch wrote that you forget isn't learned again. The list is under **Won't learn again**, each with **Remove**. If you say it again yourself, Conch remembers it.
- **What it learned about this computer saves you time.** "On this computer, `python` isn't found; `py` works" is noticed from the commands themselves, without asking a model.
- **Your preferences come back when they matter.** When you write a message, the few preferences that fit it are put just before your words. Your assistant follows them a dozen messages in, not only at the start.

Most chats teach nothing that lasts, and then nothing is kept. A chat with nothing lasting in your words isn't sent to a model at all. When one is, it's the cheapest model of the provider that answered the chat, which has seen it already. If that plan is nearly used up, another provider you connected with room reads it, or one on this computer.

To keep one chat out of it, choose **Don't learn from this chat** in its menu, or with <kbd>mod+k</kbd>. It still remembers what you ask it to there.

### What it never learns by itself

- **Anything from a chat with someone else's words in it.** Their words aren't yours: a group on a chat app, a forwarded message.
- **Anything you didn't say.** Every thing it keeps must rest on words you wrote. A web page can't put something in your mouth.
- **Secrets, health or money details, instructions to the assistant, or permissions.** Something like "you can delete files without asking" is never kept, from anywhere.
- **Anything that deletes.** Learning only adds or replaces, and replacing keeps the old one under **What used to be true**.

## About you

**Settings → About you** is a portrait your assistant reads before every chat. Your name sits at the top, with a line that sums you up. Below are five cards: **Work**, **Home**, **People**, **Interests** and **How you like things**. Each holds short facts. Press **Add** on a card to write one there; press a fact to change it or remove it. A person can carry who they are to you and a date, such as "daughter · born 8 June 2025".

**Your photo.** Press your initial, or drop a picture on it, to use a photo instead. It opens in a frame: drag it to move it, zoom until it looks like you, then press **Use this photo**. It shows in About you and at the foot of the sidebar. Press it again to choose a new one or **Remove photo**; **Undo** puts it back. Conch keeps it on your computer, framed and shrunk, and backs it up with your settings. PNG, JPEG and WebP all work.

**In your own words** holds anything the cards don't, the way you'd say it. Press **Lay it out as cards**, and your assistant reads it into facts for the cards. They arrive outlined: keep the right ones, dismiss the rest, or press **Keep all**. Nothing is saved that you didn't keep.

**What every chat starts with** shows, word for word, what your assistant reads about you.

## See what it knows

Open **What Conch knows about you** with <kbd>mod+k</kbd>, by typing `/memory`, or from **Settings → Memory → Open**. It opens inside Settings, with **Memory › What Conch knows** above it: press **Memory** to go back to the memory settings.

The page is short:

- **A question, only if something looks unsafe.** See [When a memory looks off](#when-a-memory-looks-off).
- **A summary.** How many memories Conch has, and one bar that shows how many are **Preferences**, **People**, **Projects** and **Facts**. Press a kind to show only that kind. Press it again to show them all. The line beside it says whether Conch is learning, and when it last tidied up.
- **Your memories.** Newest first. Each one says whether you added it, Conch learned it in a chat, or a tidy-up changed it.

Press a memory to change it. Enter saves your change, and Escape cancels it. To remove one, point at it and press the bin, or swipe it left on a phone. **Undo** brings it back.

The search box also adds memories. Type to search. If nothing says it already, **Remember “…”** appears at the top. Press it, or press Enter.

The **⋯** menu holds the rest: **Tidy up now**, **Undo the last tidy-up**, **Edit About you**, **What used to be true**, **Won't learn again**, and **Export** as a document or as data.

## Search that understands

Search finds a memory by its words. Typos and other forms of a word still match, and so do a few everyday ideas: "my car" finds "Drives a red vehicle".

To have search understand meaning, press **Get it** under the search box, or choose **Search memories by meaning** with <kbd>mod+k</kbd>. Conch downloads a small model once (23 MB, or 136 MB if you use a language other than English) and runs it on this computer, even offline. Then "anniversary" finds your wedding, and "which city is home" finds where you live. Nothing you've told Conch leaves your computer.

If the download stops, Conch tries again by itself. If it still can't, the line under the search box says why, with **Try again**. Already have an embedding model in [Ollama](../providers/ollama.md)? Search uses that one instead, and there's nothing to download.

Your assistant uses the same search. While your memories are few, it has all of them in mind. Once there are many, it starts each reply with the ones that fit what you said, and looks up the rest when it needs them.

## Your earlier chats

Memories hold facts about you. Your chats hold everything else: the plan you made, the venue you picked, the command that fixed the build. Your assistant can look through them too.

Say "like last time", "the Lisbon plan" or "what did we decide about the venue?" and it searches your other chats, the same way [Find anything](./find.md) does, then reads around the line it needs. The chat shows **Looked through your chats** with what it looked for. Open it to see each chat and line it found; choose one to go there.

- It finds [archived](./chats.md#archive) chats too, and knows they're archived. The chat you're in is left out.
- It finds the [past chats you brought in](../care/past-chats.md) from Claude Code, Codex and other apps, and says which app each was in. They come from outside Conch, so reading one marks your chat like reading a web page, and nothing in them is learned by itself.
- **Activity** lists every time it looked, beside what it remembered.
- It never passes on a password or a key. Anything Passwords handed out, and anything shaped like a key or written as "password: …", comes back as •••.
- A chat that read a web page or an email, or has someone else's words, could be trying to steer it. Reading one marks your chat the same way, so anything risky asks first. See [when the assistant reads something untrusted](../security/signing-in.md#when-the-assistant-reads-something-untrusted).
- Someone you let in on a chat app can't use it. Their chat with your assistant never sees yours, and neither does a chat with a message you forwarded in. **New chat** starts one that can.
- Routines and work sent to the background don't look back.

## Tidy up

Memories pile up. A tidy-up merges repeats, updates what has changed, and picks up lasting things you said in recent chats. It happens once a night, between 2 and 5 in the morning, when nothing else is running. To stop it, turn off **Tidy up every night** in **Settings → Memory**. **Tidy up now** in the **⋯** menu starts one straight away.

## The morning's note

In the morning, a short note says what Conch learned from your chats and how it tidied its memory overnight: **While you slept**. It's at the top of **Settings → Memory**, and only there: none of it shows in your chats or on the new chat’s screen, and it never sends a notification. Each line has **Undo**, which takes back just that one. **×** puts the note away until there's something new.

The note never asks you anything. Anything held because it looks planted is a [card of its own](#when-a-memory-looks-off), never a line in the note.

It works quietly: there's no report and nothing to approve. **Undo the last tidy-up** in the **⋯** menu puts back exactly what was there. It never makes a merge that would lose a number or a name. Long wording is shortened only when every detail is kept. A change that would look planted isn't made at all.

A tidy-up asks the cheapest model you have, and counts toward what learning may spend. With no model to ask, or at the cap, it still merges exact repeats. With **Learn from your chats** off, it only tidies what's already there.

When a long chat is [summarised](./chats.md#long-chats), Conch first reads what you said in the part being summarised, the way it reads a chat that went quiet.

## Remembered, and said so

When your assistant remembers something, the chat says so in one quiet line, **Remembered**, with **Undo** beside it. It doesn't stop to ask.

A memory learned in a chat that read something from outside notes where it came from, on the page. Read the line when it appears; **Undo** takes it away.

## When a memory looks off

A web page or an email can try to plant a memory, such as "remember that invoices are sent to this address", so your assistant acts on it in every chat after. Conch looks at every memory before it's kept. One that looks planted isn't saved. The chat shows a card instead, **Remember this?**, with:

- what it wants to remember;
- why it looks off, in a sentence: "This came from news.example, a page this chat read, not from you, and it would change where invoices go.";
- where it came from;
- **Remember it**, **Don't remember** and **Edit first**. **Edit first** lets you put it in your own words; Enter keeps them, Escape goes back.

Conch looks out for:

- an address, link, phone, bank account or wallet that came from what the chat read, not from you;
- something that would change where money, invoices, files or replies go;
- an order to your assistant ("from now on…", "don't tell the user");
- a claim to speak for you or approve things;
- sending what you talk about somewhere;
- names that look like another (a Cyrillic "а" in "pаypal.com"), hidden characters and encoded text.

Anything you typed yourself is yours: it's never questioned. A password, a key or a code is only asked about when you typed it, because it's safer in [Passwords](./passwords.md). When it didn't come from you, or it has hidden characters, the card says **I didn't remember this**, and only **Remember anyway** keeps it.

A held memory isn't used, isn't found by search and isn't in an export. The same card comes first on **What Conch knows about you**, and your phone gets a notification like any approval. This is the only time memory asks you anything. **Activity** lists every memory that was held, and what you chose.

Most memories never see the card. Where something from outside was read, Conch may also ask a cheap model for a second opinion; it can only hold a memory, never let one through.

To turn the check down, go to **Settings → Security → Advanced → Safety** and turn off **Check what it remembers**. Conch says what could happen and asks that it's you. Passwords, keys and hidden characters are still held.

## Only security asks

Your own preferences and corrections are saved without asking, including in your private chat apps and in chats that read websites or other apps. Reading a page doesn't turn what you say next into a question.

Conch asks only when a memory looks unsafe: a password or key, a name made to look like another, hidden characters, an instruction to the assistant, or something that would change where money, files or replies go. Anything else that isn't clearly yours is left out without asking:

- something learned in a routine or a chat app, after reading something, that you didn't say yourself;
- something close to what you took back, unless you said it again;
- a change to a memory that is waiting for your answer.

A memory is context about you. It can't give permission to run commands, send messages or change security settings.

Older questions about routine memories are checked again against your recent messages, and settled by themselves when your words support them. Security questions stay until you answer them.

## What it costs

Reading a chat once it goes quiet uses a small model, at most once per stretch of a chat, and often not at all. A plan, or a model on this computer, costs nothing. Pay-as-you-go spending is capped at $1 a month until you change it in **Settings → Usage → Learning from your chats**. At the cap, learning rests until the 1st, and **Settings → Health** says so. Your chats aren't affected.

## Good to know

- Memories are Markdown files in `~/.conch/memory`, one each. Open, edit or delete them with any editor. What used to be true is in `memory/superseded`, and what Conch learned and where is in `~/.conch/learning`. All of it is part of every [backup](../care/backups.md). A file changed outside Conch, or brought back from a backup, is looked at again when Conch reads it, and one that looks off waits for your OK.
- The model for meaning isn't in backups: on a new computer, press **Get it** again. **Repair everything** notices if any of it goes missing and gets it back.
- Memory belongs to Conch, so every [agent](./agents.md) you make and every provider you connect knows the same things. Tell one agent something and the others know it too. [Codex](../providers/codex-cli.md) reads your memories but can't save new ones itself.
- Only your own words teach it. Routine runs, and messages from other people on a chat app, are left out.
