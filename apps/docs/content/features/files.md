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
tables, code is coloured, and sound and video play. A phone's browser shows only a
PDF's first page there: **Open** shows all of it in a new tab.

Everything else shows what's in it, read on your computer:

- Documents (Word, OpenDocument, RTF, e-books) show their words.
- Spreadsheets show a tab for each sheet, and a database shows a tab for each table.
- An archive shows its folders and files. Press a folder to open it.
- An email shows who sent it, to whom, when, its words and the names of its attachments.
- Under a recording or a video you see what's said in it. Press a time to play from
  there. A long one fills in while Conch listens.
- A notebook shows its notes, its code and what the code printed.
- A program, a font or a file Conch doesn't know says what it is, with **Download**.

Each kind has its own icon and colour on its card, so you can tell an email from an
e-book before you open it.

- <kbd>left</kbd> and <kbd>right</kbd> move between cards; the cross takes one off.
- A card that didn't upload says why and offers to try again.
- After you send, cards sit above your message and open the same way, with type, name,
  size and **Download**.

## What your assistant gets

- Text goes with your words.
- Pictures go to models that can see. Others get a description written by one of your
  models that can.
- Documents work with any provider: PDF; Word, Excel and PowerPoint, new or old (DOCX,
  DOC and the rest); OpenDocument (ODT, ODS, ODP); EPUB books; RTF; emails (EML, MBOX
  and Outlook's MSG); and Jupyter notebooks. A model reached by an API key gets the
  words with your message; one that opens files itself gets the file, and Conch reads
  it for it on request. Tool-using models can read on through pages, sheets, slides,
  chapters and messages.
- Spreadsheets arrive as tables with their sheet names, column letters and row numbers,
  up to 5,000 rows a sheet. Dates read as dates.
- An email arrives as who sent it, to whom, when, its words and the names and sizes of
  its attachments. Attachments inside an email aren't opened: attach any that matter
  on their own.
- PDFs keep their charts, layout and scans. Claude, OpenAI's models that see, Gemini and
  OpenRouter models that take files get the whole PDF, up to 100 pages and 4 MB, with
  the start of its text. Other models get the text, and pages with little or no text
  (a scan, a chart, a photo) are drawn on your computer and shown as pictures, up to 8,
  or described for a model that can't see. Codex gets the text and pictures too; Claude
  Code opens the PDF itself. A PDF only goes to the provider your chat is with: on
  OpenRouter, only models that read files themselves get one, so it's never passed on
  to another company to read. After six more of your messages the whole PDF stops being
  sent, so a long chat doesn't pay for it every time; its text stays. A PDF locked with
  a password can't be read: send one without.
- Recordings and videos work with any model. Conch listens to them on your computer
  and gives your assistant what's said, with times, up to the first hour. A video
  also sends up to eight pictures from it to models that can see, with its length
  and size. Nothing goes to a new service. It needs FFmpeg and private dictation,
  which Conch gets in **Settings → Voice**. A long one is still being heard after you
  send; your next message has the rest.
- Pictures no model takes, like Photoshop files, icons and cameras' RAW photos, are
  shown to it as a JPEG made on your computer; your file stays as it was. An SVG goes
  as its source and as a picture.
- A SQLite database (an app's saved data, a `.db` or `.sqlite` file) works with any
  model: Conch opens it read-only on your computer and gives your assistant its tables,
  how many rows each has, and the first rows.
- Any other file is named from what's inside it: a program, a font, a 3D model, a disk
  image, a data file. A model that opens files itself is told which tools on your
  computer read it; any other model gets what it is, its size and the readable text
  inside. Nothing in it is run. Files that hold passwords or keys, like a keychain,
  are named but never shown.
- Archives work with any model: ZIP (and JAR, APK and other ZIPs by another name), tar,
  tar.gz and other compressed tars, one compressed file, and 7-Zip, RAR and CAB when your
  computer has `bsdtar` (Macs and Windows do). Conch looks inside without unpacking it and
  gives your assistant the list of files, the text of the useful small ones (a README
  first), and up to two documents inside. It says what it left out. Links inside are never
  followed, and names that point outside the archive are never read.
- A ZIP can be unpacked into the chat: up to 50 files, 30 MB each.
- Office files from before 1997 (Word 95, Excel 95) need LibreOffice on your computer,
  or saving as DOCX, XLSX or PPTX first. Formulas, macros, scripts and external links
  never run. A locked document or a book with DRM can't be read: send one without.

When the model you picked can't use something, its card shows a dot with the reason,
and a file it can't open sends what Conch could tell about it. Choose another model in the **Model ·
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
