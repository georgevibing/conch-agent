---
title: Files and pictures
description: Drop a file, paste a screenshot or a long text into a message, and your assistant works with it.
order: 7
---

Each file you give your assistant becomes a card on your message.

## Add something

- Drop files anywhere on the chat (it says **Drop to attach**).
- Press **Attach files**, the plus in the message box.
- Paste a screenshot or a copied file into the box.
- Press <kbd>mod+k</kbd> and choose **Attach files**. More in [Find anything](./find.md).

Cards upload as soon as they're added. A message can be attachments alone.

## Long pastes fold

Over 1,000 characters or 20 lines becomes a **Pasted text** card showing its first
lines. Open it to read or edit; **Paste into message** puts it back as plain text. To
skip the card, paste with <kbd>mod+shift+v</kbd>.

## Look before you send

Click a card: pictures show large, PDFs open in the browser's viewer, CSVs become
tables, code is coloured, sound and video play, the rest offers **Download**.

- <kbd>left</kbd> and <kbd>right</kbd> move between cards; the cross takes one off.
- A card that didn't upload says why and offers to try again.
- After you send, cards sit above your message and open the same way, with type, name,
  size and **Download**.

## What your assistant gets

- Text goes with your words.
- Pictures go to models that can see. Others get a description written by one of your
  models that can.
- PDF, DOCX, XLSX and PPTX text works with any provider. Tool-using models can read on
  through pages, sheets and slides. Scanned pages without text are flagged; they need
  visual or OCR reading.
- A ZIP can be unpacked into the chat: up to 50 files, 30 MB each.
- Older Office files need saving as DOCX, XLSX or PPTX first. Formulas, macros and
  external links never run.

When the model you picked can't use something, its card shows a dot with the reason,
and a file it can't open sends only its name. Choose another model in the **Model ·
Mode** chip, or send anyway. [Compare providers](../providers/index.md).

Your assistant treats attachments as material, not instructions.

## Good to know

- Up to 20 attachments per message, 30 MB each.
- Photos reach the model upright, scaled, without location; your original is unchanged.
- iPhone HEIC photos become JPEG; Excel CSVs and other encodings are read correctly.
- Folders can't be attached: drop the files inside, or zip it.
- The same file picked twice is attached once.
- Attachments stay on your computer with the chat and are in your
  [backups](../care/backups.md). Delete a chat and what only it used goes too.
- A [background task](./tasks.md) can't take attachments yet.

## Choose the working folder

Your assistant works in one folder. To change it, press the **Model · Mode**
chip under the message box, then **Change** beside **Folder** (or **Settings → General**,
or `/folder`).

- **In the Conch app**: your computer's Open dialog.
- **On a phone or in a browser**: start from **Home**, **Desktop**, **Documents**, a
  projects folder or a recent one. Press a folder to go in, the trail to go back. Type
  to filter, make a **New folder**, then **Choose**.
- **Type a path**: Conch suggests folders, <kbd>tab</kbd> finishes a name, and it says
  when nothing's there.

It never shows file contents, Conch's own folder, or where keys and sign-ins are kept.
The same chooser picks a folder for a [routine](./routines.md) to
watch and your KeePassXC database in [Passwords](./passwords.md).

## Find and read work files

Ask for a filename or words in a file; Conch returns paths and line numbers, no
terminal needed.

- It skips links, protected files, dependencies and build output.
- Content search reads text files up to 2 MB; paged reading handles UTF-8 up to 30 MB.
- Long lines and cut-short searches are marked, with a way to continue where possible.

## Get finished work

A file your assistant makes gets a card showing it take shape, then its first page,
rows or words, size, and page, sheet or slide count.

- Press it, or **Look closer**, for a preview. **Download** saves it. **Details** says
  what made it and when.
- With a chat app set up, **Send to** drafts the request in the message box.

The file is kept with this chat even if the original changes. Ask for this chat's files
to find them again.

## Ask for a file in any format

"Make that a PDF." Conch makes it with any chat model and nothing to install:

- **PDF** with headings, tables, page numbers and your chat's pictures, printed by
  Conch's browser sealed off from the internet. Without a working browser (on a server,
  say), a plainer PDF in your computer's fonts, so Greek, Cyrillic, Chinese and other alphabets print as real letters;
  Conch then gets a browser for next time.
- **Word (DOCX)** with headings, lists, tables and pictures.
- **Excel (XLSX)** and **CSV** with real numbers, dates and formulas, and a frozen,
  filtering header row.
- **PowerPoint (PPTX)**: a title slide, then a slide per point, with any picture you
  give.
- **Charts** as PNG or SVG: bars, lines, areas or a pie.
- **Markdown**, **text**, **HTML** and **JSON**.

It can also change a file you have:

- **Convert**: Markdown, text, Word or HTML to PDF or Word; a spreadsheet to CSV or
  JSON and back, or to PDF, a web page or a Markdown table; photos to PDF; SVG to PNG; a
  PDF's text to text, Markdown or Word (no layout or pictures); a presentation's to text
  or Markdown.
- **Combine** up to 20 PDFs and photos into one PDF, in your order, or any files into a
  ZIP.

Each chat makes one file at a time, up to 30 MB. A PDF from a web page loads nothing
from the internet and runs none of its scripts.

**Settings → Health** has a **Making PDFs** line. If no browser can print, **Repair
everything** gets one. If something only you can add is missing (on a Linux server, the
browser's libraries or fonts), it shows the one command to run.

## Files in your chat apps

"Send me the PDF on Telegram" delivers it there, and in a chat started from an app,
what Conch makes comes back with the answer:

- pictures as photos, captioned with the message;
- PDFs, documents, spreadsheets and archives as named files;
- music and video in the app's player, where it has one (Telegram, Matrix, WhatsApp for
  video).

Some take only pictures, or no files; Conch says so. Limits are on each app's page in
[Chat apps](../channels/index.md).
