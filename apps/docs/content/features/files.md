---
title: Files and pictures
description: Drop a file, paste a screenshot or a long text into a message, and your assistant works with it.
order: 7
---

Give your assistant something to look at: a photo, a PDF, a spreadsheet, a log. Each one becomes a card on your message, so the box stays a place to write.

## Add something

There are four ways, and they all end the same:

- Drop files anywhere on the chat. It dims and says **Drop to attach**.
- Press **Attach files**, the plus in the message box.
- Paste a screenshot or a copied file into the box.
- Press <kbd>mod+k</kbd> and choose **Attach files**. More in [Find anything](./find.md).

A card uploads the moment it's added, so sending is instant. A message can be attachments alone, with no words.

## Long pastes fold

Paste more than 1,000 characters or 20 lines and it becomes a **Pasted text** card that shows its first lines, instead of filling the box.

Open the card to read or edit the text before you send it. **Paste into message** puts it back in the box as plain text. To skip the card from the start, paste with <kbd>mod+shift+v</kbd>.

## Look before you send

Click any card for a closer look. Pictures are shown large, PDFs open in your browser's viewer, a CSV becomes a table, code is coloured, and sound and video play. Anything else says there's no preview and offers **Download**.

With several cards, <kbd>left</kbd> and <kbd>right</kbd> move between them. To take one off, press the cross on its corner. A card that didn't upload says why and offers to try again.

After you send, the cards sit above your message and open the same way.

## What your assistant gets

Each provider gets an attachment in the way it can use:

- Text goes along with your words.
- Pictures go to models that can see. A model that can't gets a description, written by one of your models that can.
- PDF, DOCX, XLSX and PPTX text can be read with any provider that supports tools. The assistant can continue through pages, sheets and slides. Scanned pages without text are identified; they need visual or OCR reading.
- Older Office files need saving as DOCX, XLSX or PPTX first. Formulas, macros and external document links are never executed.

When the provider or model you picked can't use something, its card shows a small dot before you send, with the reason. A file it can't open only gets its name. Choose another in the model picker, or send it anyway. [Compare providers](../providers/index.md).

Your assistant is told that attachments are material to work with, not instructions to follow.

## Good to know

- Up to 20 attachments per message, 30 MB each.
- A photo too big for the models is scaled down for you before it uploads.
- A folder can't be attached. Drop the files inside it, or zip it first.
- The same file picked twice is attached once.
- Conch keeps attachments on your computer, with the chat. Delete a chat and what only it used goes with it.
- They are in your [backups](../care/backups.md), with your chats.
- A [background task](./tasks.md) can't take attachments yet. Send those as a message.

## Choose the working folder

Your assistant reads and writes in one folder. Press the folder at the foot of the message box (or **Settings → General**, or type `/folder`), and choose another:

- **In the Conch app**, it's your computer's own Open dialog.
- **Anywhere else**, a phone or a browser, Conch shows the computer's folders. Start from **Home**, **Desktop**, **Documents**, a projects folder or one you chose lately; press a folder to go into it, and the trail above to go back. Type to filter what's there, make a **New folder** where you are, then press **Choose**.
- **Prefer typing?** Press **Type a path**. Conch suggests folders as you type, <kbd>tab</kbd> finishes a name, and it says when nothing's there.

It shows folders, never what's in your files, and never Conch's own folder or where your keys and sign-ins are kept. The same chooser picks a folder for a [routine](./routines.md) to watch, and your KeePassXC database in [Passwords](./passwords.md).

## Find and read work files

Ask for a filename or words inside a file. Conch searches without needing a
terminal utility and gives the assistant matching paths and line numbers. It
skips links, protected files, dependencies and build output. Content search
reads text files up to 2 MB; paged reading supports UTF-8 files up to 30 MB.
Long lines and incomplete searches are marked, with a continuation when available.

## Get finished work

Ask for the finished file when the assistant creates a report, spreadsheet,
presentation, picture or archive. Its card opens a preview and offers **Download**.
The file is kept with this chat even if the original in the work folder changes.
Ask to list this chat’s files to find attachments and finished downloads again.
