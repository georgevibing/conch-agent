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

After you send, the cards sit above your message and open the same way. A file shows its type, name and size, with **Download** beside it.

## What your assistant gets

Each provider gets an attachment in the way it can use:

- Text goes along with your words.
- Pictures go to models that can see. A model that can't gets a description, written by one of your models that can.
- PDF, DOCX, XLSX and PPTX text can be read with any provider. A provider that can't open files gets the text with your message; any provider that uses tools can read on through pages, sheets and slides. Scanned pages without text are identified; they need visual or OCR reading.
- A ZIP can be unpacked into separate files of the chat, to read, convert or send on.
- Older Office files need saving as DOCX, XLSX or PPTX first. Formulas, macros and external document links are never executed.

When the provider or model you picked can't use something, its card shows a small dot before you send, with the reason. A file it can't open only gets its name. Choose another in the model picker, or send it anyway. [Compare providers](../providers/index.md).

Your assistant is told that attachments are material to work with, not instructions to follow.

## Good to know

- Up to 20 attachments per message, 30 MB each.
- A photo goes to the model the way models take it: turned upright, scaled to fit, and without where it was taken. The one you sent stays as it was.
- An iPhone's HEIC photo becomes a JPEG every model can see. A CSV saved by Excel, or a text file in another encoding, is read as it should be.
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
presentation, picture or archive. While it's made, its card shows the file taking
shape and how far it got. Once it's there, the card shows its first page, rows or
words, its size and how many pages, sheets or slides it has. Press it, or
**Look closer**, for a preview. **Download** saves it, and **Details** says what
made it and when. With a chat app set up, **Send to** writes the request in the
message box for you to send.
The file is kept with this chat even if the original in the work folder changes.
Ask to list this chat’s files to find attachments and finished downloads again.

## Ask for a file in any format

Ask in your own words: “make that a PDF”, “put these numbers in a spreadsheet”,
“turn my notes into slides”, “chart this”. Conch makes the file itself, with any
chat model and nothing to install:

- **PDF**, laid out for print with headings, tables, page numbers and your
  chat's pictures. Conch prints it with the browser it already uses, sealed off
  from the internet. Without a browser it still makes the PDF, plainer.
- **Word (DOCX)**, with real headings, lists, tables and pictures, to edit in
  Word, Pages or Google Docs.
- **Excel (XLSX)** and **CSV**, with real numbers, dates and formulas, and a
  header row that stays in view and filters.
- **PowerPoint (PPTX)**: a title slide, then a slide for each point, with a
  picture beside the points when you give one.
- **Charts** as PNG or SVG: bars, lines, areas or a pie.
- **Markdown**, **text**, **HTML** and **JSON**.

It can also change a file you already have:

- **Convert** Markdown, text, Word or HTML to PDF or Word, a spreadsheet to CSV
  or JSON and back, photos to a PDF, and an SVG to a PNG. The text of a PDF or
  a presentation comes out as text or Markdown.
- **Combine** several PDFs and photos into one PDF, in the order you say, or
  any files into a ZIP.

A file is made one at a time in each chat, at most 30 MB. A PDF made from a web
page never loads anything from the internet and runs none of its scripts.

## Files in your chat apps

Ask to have a file sent to you (“send me the PDF on Telegram”) and it arrives in
the app you chose. In a chat you started from an app, what Conch makes comes back
there with the answer. Each app gets it the way it shows files:

- pictures as photos, with the message as their caption;
- PDFs, documents, spreadsheets and archives as files with their own names;
- music and video in the app's own player, where the app has one (Telegram,
  Matrix, WhatsApp for video).

Some apps take only pictures from Conch, or no files at all; Conch says so
instead of pretending it sent them. Each app's limits are on its page in
[Chat apps](../channels/index.md).
