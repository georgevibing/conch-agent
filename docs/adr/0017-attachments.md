# 0017 — Attachments: long pastes, files and pictures

- Status: accepted
- Date: 2026-09-30

## Context

Pasting a web page, a log or an email thread into the composer poured
thousands of lines into the box, so it stopped being a place to write. There
was no way to send a file or a picture at all, although every provider Conch
drives can use some of them: Claude sees images and Claude Code opens PDFs and
spreadsheets itself, Codex reads files by path, and the model APIs take images.

How others fold long pastes:

| App                        | Folds a paste when…                                       | Source                                                  |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Codex CLI                  | more than 1 000 characters                                | `LARGE_PASTE_CHAR_THRESHOLD` in `chat_composer.rs`      |
| Open WebUI                 | more than 1 000 characters (opt-in; Shift+paste bypasses) | `PASTED_TEXT_CHARACTER_LIMIT` in `src/lib/constants.ts` |
| Claude Code CLI            | more than 800 characters or 3+ newlines                   | its shipped `cli.js`                                    |
| claude.ai, ChatGPT, Gemini | folds long pastes into a card; threshold not published    | help centres (Sept 2026)                                |

Published file limits: claude.ai takes 20 files per chat, 30 MB each in
projects; Gemini 10 per prompt; ChatGPT 512 MB per file.

## Decision

**One road for everything.** A file, a pasted screenshot and a long paste are
all uploaded as raw bytes to `POST /api/attachments` the moment they're added,
and the message carries only their ids (`conversation.send.attachments`). The
`user.message` event records what was attached, so the transcript, search and
handoffs know. A message may be only attachments.

**Folding.** A paste of more than 1 000 characters or more than 20 lines
becomes a **Pasted text** card (`PASTE_FOLD` in `@conch/protocol`). The
character threshold follows Codex CLI and Open WebUI. Claude Code's line rule
is tuned for terminals and would fold ordinary snippets in a web page, so we
use 20 lines instead. Shift+paste always pastes inline. The card shows the
first lines in type; clicking it opens a preview where the text can be edited,
or put back into the message with **Paste into message**.

**Every kind has a face.** Nacre's `AttachmentCard` gives each family its
glyph and tint: pasted text, text, code, data/CSV, PDF, documents (ODF, RTF
and old Office too), sheets, slides, archives, pictures, audio, video, email,
e-books, databases, fonts, 3D models, programs, notebooks, and a fallback; the
sent `FileTile` uses the same families. `AttachmentPreview` shows pictures on
a stage, PDFs in the browser's viewer, CSVs as a table, highlighted code,
native audio and video, and everything else from its view (below). Dropping files anywhere on the chat
(`useFileDrop` + `DropOverlay`), the attach button, a pasted screenshot and
⌘K **Attach files** all add cards.

**The gateway decides what a file is,** from its bytes: an image only if its
header says PNG, JPEG, GIF or WebP; `text` if it's valid UTF-8 without NULs;
otherwise a `file`. The name and the browser's claim only break ties. Names
are cleaned (no folders, control or bidi characters, Windows-reserved names).

**Each provider gets what it can use** (`Engine.attachments`, surfaced as
`Capabilities.attachments`, and `ModelInfo.images` per model):

| Provider    | images                              | files (by path)                     | documents                               | PDFs (`readers/pdf.ts`)                                  |
| ----------- | ----------------------------------- | ----------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Claude Code | content blocks                      | yes (`additionalDirectories`)       | by path, or `read_document`             | by path: its Read sees pages (`opensPdfs`)               |
| Codex CLI   | by path (`localImage`)              | yes                                 | `read_document` by id or path           | path, text inline, thin pages as pictures                |
| ACP agents  | yes                                 | yes                                 | `read_document` by id or path           | path, text inline, thin pages as pictures                |
| API engines | content blocks / data URLs, if seen | no                                  | text inline, then `read_document` by id | whole where the model reads PDFs, with its start as text |
| Mock        | yes                                 | no (keeps the degraded path tested) | text inline                             | text inline, thin pages as pictures                      |

Text always goes inline, fenced in `<attachment>` tags inside an
`<attachments>` block before the person's words, up to 150 000 characters
each and 400 000 in all. Past that, engines that open files get the start and
the path, the rest get the start and a note.

**Documents reach every provider** (amended October 2026). "Opens files" is
the engine's own (`Engine.attachments.files`: Claude Code, Codex, ACP
agents); reading by id with Conch's `read_document` and `read_file` is a
separate ability (`hostTools`). An API engine has only the second, so a PDF,
DOCX, XLSX or PPTX sent to it carries its text, taken out by Conch's sealed
reader (up to 60 000 characters), with the attachment's `id` and, when more
remains, how to read on with `read_document`. Before, any engine with Conch's
tools counted as opening files, so an API model got only a path and a hint to
call `read_document`; one taking its tools in words (OpenAI's GPT-6.1 Sol and
GPT-6 Astra have no function calling on Chat Completions) or a chat-only one
often never did, and answered without the document. A document with no text
to take out (a scan, a locked file) says so, with what to ask for instead;
a model without Conch's tools is never told to call one. If preparing the
attachments fails outright, the model still hears what was attached. What a provider can't use is
named with a plain note so the model can say so. The composer warns first:
a card whose provider can't use it gets a dot and a sentence.

**Limits.** 20 attachments per message, 30 MB each, checked in the browser
first (with the reason on the card) and again by the gateway. Pictures larger
than 5 MB or 8 000 px are scaled down to 4 096 px in the browser before upload
(GIFs are left alone).

**Pictures as models take them** (`attachments/fit.ts`, sharp). Before an
image goes to any provider the gateway turns it upright from its EXIF flag,
scales it to 2 000 px on its long edge and 3.7 MB at most (Claude's 5 MB of
base64; OpenAI reads 2 048 px), and drops its metadata, so a photo's location
never leaves with it. One that already fits and carries none goes as it is.
The fitted copy is kept beside the original as `.for-models.<ext>`, made once;
Codex gets it by path (`localImage`), so a photo isn't carried through its
connection as base64. HEIC, HEIF, AVIF, TIFF and BMP become a JPEG when saved
(sharp, else macOS `sips`, libheif's `heif-convert` or ImageMagick); when
nothing here converts one, the model is told plainly and asks for a JPEG.
Text that isn't UTF-8 (UTF-16 with a BOM, a Windows-1252 CSV) is stored as
UTF-8.

**Programs that echo pictures** (`lib/json-lines.ts`). Codex's app server and
ACP agents send the photo back (an echoed message, a replayed conversation)
inside one JSON line. Their readers set any long base64 string aside as it's
read, keeping only its `data:…;base64,` start, so a 20 MB echo costs a few
kilobytes; a line still over 64 MB is skipped, never the connection, and a
request it answered ends with a sentence instead of waiting.

The same file picked twice is attached once. Folders are
refused, with what to do instead. A file dropped next to the chat no longer
navigates the tab away.

**Storage and cleanup.** `~/.conch/attachments/<id>/` holds `meta.json` and
the file under its cleaned name, owner-only. An upload belongs to nobody until
it's sent; taking a card off deletes it; unsent uploads older than a day (and
folders half-written by a crash) are swept at start and hourly. Deleting a chat
deletes what only it used.

**Long prompts to Codex** go on stdin (`-`) past 32 KiB instead of the command
line: Linux refuses single arguments over 128 KiB, and argv is readable by
other users in `ps`.

### PDFs past their words (`readers/pdf.ts`, `engines/api/documents.ts`)

A PDF's text leaves out its charts, its layout and every scanned page. The
`pdf` reader runs before `documents` and adds what text leaves behind:

- **Whole, to the models that read PDFs.** An engine whose wire can send one
  (`Engine.attachments.pdfs`, `Wire.takesPdfs`) gets it as a `TurnDocument`
  (name, base64, pages, bytes), up to 100 pages and 4 MB (the saved
  transcript stays under its 8 MB). Per model, `Wire.pdfsFor` says what it
  takes, and the engine sends as many as fit its pages, bytes and half its
  window; a line after the message tells the model which it got. Its text
  still comes, shortened to 20 000 characters: a model that can't read the PDF
  whole, and the summary of a long chat, still have its words.

  | Provider (wire)                       | Shape                                                                                  | Limits Conch keeps to                  | Source                                                                                                                                                                                                                                                                                                                                              |
  | ------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Anthropic API, Bedrock, Vertex        | `{type:'document', source:{type:'base64', media_type:'application/pdf', data}, title}` | 100 pages, 32 MB, ~3 000 tokens a page | [PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support): 32 MB, "600 (100 when the request's context window is under 1M tokens)", "1,500–3,000 tokens per page" plus each page's picture. Bedrock and Vertex are the Messages API here, so Bedrock Converse's citations rule (pictures only with citations) doesn't apply. |
  | OpenAI (models that see)              | `{type:'file', file:{filename, file_data:'data:application/pdf;base64,…'}}`            | 100 pages, 50 MB, ~1 500 tokens a page | [File inputs](https://developers.openai.com/api/docs/guides/pdf-files): text and a picture of each page, "requires models with vision capabilities", 50 MB a request; `ChatCompletionContentPart.File` in openai-node.                                                                                                                              |
  | Gemini (its OpenAI endpoint)          | the same `file` part                                                                   | 1 000 pages, 50 MB, 258 tokens a page  | [Document processing](https://ai.google.dev/gemini-api/docs/document-processing): "up to 50MB or 1000 pages", "258 tokens" a page. The OpenAI endpoint documents no PDFs, so this is tried and healed.                                                                                                                                              |
  | OpenRouter (models listing `file`)    | the same `file` part, and `plugins:[{id:'file-parser', pdf:{engine:'native'}}]`        | 100 pages, 20 MB                       | [PDF inputs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs): without `native`, a model that can't read files gets the PDF through Mistral's OCR, at $2 per 1 000 pages, billed even with your own key. That's a company the person didn't choose, so only models whose `input_modalities` include `file` get one.                      |
  | Other chat presets, Ollama, LM Studio | none                                                                                   | text, and pictures of thin pages       |                                                                                                                                                                                                                                                                                                                                                     |

  A model that refuses one before saying a word (`refusesDocuments`) gets
  the text in its place, is asked once more and is remembered, the way a
  model that can't see is (ADR 0070). A PDF counts as its pages in the
  window (`PAGE_TOKENS`, from the page count the engine knows, else its page
  objects), not as base64. The person's pictures always stay in the
  transcript; a PDF stays whole for six of the person's messages
  (`KEEP_DOCUMENT_TURNS`), then becomes a line that says its text is with the
  message, so a long chat doesn't pay for it on every request after it's
  done with.

- **Pictures of thin pages.** Each of the first 20 pages with fewer than 200
  letters (a scan, a chart, a photo; OpenClaw's rule too) is drawn as a JPEG,
  at most 8 pages, 1 568 px on the long edge and about 4 megapixels between
  them. They go to a model that sees, into words through the describer for
  one that doesn't (ADR 0070), and ride with a PDF sent whole for a model
  that turns out not to read it. They're kept beside the attachment
  (`.for-models-pdf-page-N.jpg`, `.for-models-pdf.json`), so Codex gets
  them by path and no page is drawn twice. Where this computer can't draw
  (no canvas for this platform), the model is told which pages have no text.
  A PDF locked with a password is said plainly.
- **Codex and ACP agents** open files but have no PDF reader of their own
  (Codex runs shell commands, and `pdftotext` usually isn't there), so they
  get the text and the pictures too (`everywhere`). Claude Code's Read sees a
  PDF's pages itself (`Engine.attachments.opensPdfs`), so it gets the path
  and nothing more.

Drawing uses pdf.js, already here for reading, on `@napi-rs/canvas`, which
pdf.js brings as its own optional dependency: no new package. Nothing leaves
the computer for this; macOS `sips` and `qlmanage` draw only a first page,
and poppler isn't installed by default.

Tests: `readers/pdf.test.ts` (whole, its pictures, the page cap, a locked
file, Claude Code, Codex, a failed look, a lying file, the real worker
drawing only the textless page, kept for the next turn),
`engines/api/documents.test.ts` (each provider's shape, OpenRouter's native
plugin and its file-only gate, counting by pages, ageing, refusals, and the
engine: whole, pictures instead, in words for a model that can't see, page
and window caps, healing a refusal).

### Recordings and videos (`readers/media.ts`)

No provider hears a recording or watches a video it's given as a file, so the
`media` reader runs for every engine (`everywhere`), Claude Code and Codex
included. It matches audio and video by type or name, and only when the
first bytes are a real container (`sniffMedia`: MP3, ADTS AAC, M4A/MP4/MOV/3GP,
Ogg/Opus, WAV, FLAC, AMR, CAF, Matroska/WebM, AVI).

- **Facts** from FFprobe beside FFmpeg (or FFmpeg's own report of its input
  when there's no FFprobe): length, a video's size, and its title, artist,
  album and date, cleaned of control characters and cut to 200 characters.
- **What's said** is heard with the voice service's whisper.cpp and model
  (ADR 0077), ten minutes at a time (`VOICE_NOTE_SECONDS`), up to the first
  hour, each part marked with when it starts. whisper.cpp keeps its own queue
  of two; FFmpeg decoding for media runs one at a time.
- **What a video shows**: one picture per ten seconds, evenly spaced, at most
  eight, at most 1 280 px wide and fitted for models (`fit.ts`), go to engines
  that see as images, their times listed in the text. A model that can't see
  is told the pictures aren't there.
- **Made once.** What was found is kept beside the file
  (`.for-models-media.json`, `.for-models-frame-N.jpg`; the store's `ownName`
  already keeps a user's file from taking those names). A turn waits at most
  90 s; a long recording keeps being heard (30 minutes at most) and the next
  message has the rest, with a note saying so meanwhile.
- **Fails well.** No FFmpeg, no whisper.cpp, no speech model or a model still
  downloading: the model is told which, and that Conch gets it in
  **Settings → Voice** (the `ffmpeg` and `whisper` needs, ADR 0016). Nothing is
  sent to a new service: no hosted transcription is used.
- **Untrusted input.** FFmpeg and FFprobe are run with argument arrays, never a
  shell, with `-nostdin`, the container forced (`-f`) from the sniffed bytes,
  `-format_whitelist` of media containers only, `-protocol_whitelist file`,
  `-probesize` capped, and the path as `file:<path>`, so a name can't read as
  an option or another protocol. Output is capped in bytes and time.

### Pictures, databases and every other file (`readers/pictures.ts`, `sqlite.ts`, `binary.ts`)

These readers run for every engine (`everywhere`): Claude Code and Codex can't
look inside a PSD or a RAW photo either, and knowing a database's tables or what
a binary is saves them a step. Hermes Agent and OpenClaw do the same (SVG drawn,
SQLite schema and sample rows, "inspect the file yourself" for the rest).

- **Pictures no provider takes** (Photoshop, ICO/CUR, JPEG 2000, JPEG XL,
  OpenEXR, DDS, QOI, camera RAW) stay as they are and are shown to engines
  that see as a JPEG made for the turn (`toJpeg`, then `fitPicture`). A RAW
  file is TIFF inside, so `sniff` keeps one named `.cr2`, `.nef`, `.dng` and
  so on as `image/x-dcraw` rather than letting the store swap it for the small
  preview sharp would find; it's developed by `sips` or ImageMagick first. An
  SVG stays text and is also drawn by sharp (10 s, 2 MB, no fetching) as a
  PNG for engines that see. Pictures for a model that can't see are described
  by another (ADR 0070): the API engines did this already; ACP agents now do too.
- **SQLite** (`SQLite format 3\0`, whatever the name): read in the sealed
  worker (`files/worker.ts`) from the bytes on stdin, loaded with
  `deserialize`, so no file is opened, locked or written; a WAL-mode header is
  set to rollback in the copy. Defensive mode, no extensions,
  `trusted_schema = OFF`, `query_only`; only Conch's own `SELECT`s run, on
  ordinary tables (views and virtual tables are only listed). At most 200
  tables, 5 rows each, 200 characters a cell, 20 s. The model gets each table's
  `CREATE` statement, row count and first rows in Markdown (escaped so a value
  can't break a row or a fence); the preview gets them as tables. An engine that
  opens files is told it may query it with `sqlite3 -readonly`.
- **Everything else** (`binary.ts`, last in the list) is named from its magic
  bytes: programs (ELF, Mach-O, PE, WebAssembly, DEX, Java classes, with their
  machine), fonts, 3D models (glb, binary STL, FBX, Blender), data files
  (Parquet, Arrow, Avro, ORC, HDF5, NumPy, pickle, GGUF, safetensors, binary
  plists, pcap), disk images and installers, archives, older Office files,
  sound and video, and DER certificates (subject, issuer, dates, fingerprint
  with `node:crypto`'s parser). An engine that opens files gets what it is and
  which tools here read it, told to look itself, read-only, rather than ask for
  a paste. Any other engine gets the facts, a 64-byte hex head and up to 1 500
  characters of printable strings, framed as the file's content, not
  instructions. Keychains, password databases, PKCS #12, keystores and
  encrypted files are named, never shown. Programs are flagged "never run it".
  Parquet, Arrow and the rest aren't read further: no reader for them is
  installed, and adding one is a dependency decision.

### Archives (`readers/archives.ts`)

A ZIP (and the JARs, APKs, wheels and other ZIPs by another name), a tar,
tar.gz, tar.zst, tar.bz2 or tar.xz, one compressed file (`.gz`, `.zst`,
`.bz2`, `.xz`), a 7-Zip, RAR, CAB or XAR archive is read for every engine
(`everywhere`, after `documents`): a list of what's inside (path, size, when
it changed, sorted, up to about a third of the room), then the text of its
most useful small files (README first, then manifests such as `package.json`
or `MANIFEST.MF`, then docs and source; `node_modules`, `.git`, `__MACOSX`,
lock files and minified code last), then up to two documents inside (a PDF,
a DOCX) through the other readers. The note says what was left out (files not
listed or not shown, links, names that point outside, locked files) and how
to get more: an API model with Conch's tools is pointed at `file_unzip` for a
ZIP (nothing unpacks other formats yet); a model that opens files gets a
shorter look (12 000 characters, no nested documents) and is told to unpack
it with its own tools into a new, empty folder in the work folder; a chat-only
model is told to say what it's missing. An archive inside an archive is only
listed. The preview gets the tree and the text files (`view`).

- **Nothing is unpacked to disk.** ZIP (from its central directory, ZIP64
  included, counted by signature since writers wrap the count past 65 535),
  tar (ustar, pax and GNU long names, streamed), gzip and zstd (Node's zlib)
  are read in a sealed worker (`files/archive-worker.mjs` through
  `files/worker.ts`: bytes on stdin, no file system, subprocess or network
  permission). A member's name is only ever a string there.
- **Bomb limits.** At most 100 000 entries looked at (past that only
  counted) and 2 000 described; gzip and zstd expanded at most
  `min(512 MB, max(64 MB, 100 × the file))`, streamed, so a tar is listed
  without holding it; ZIP members inflated at most 48 MB in all, never past
  the size the directory claims (`maxOutputLength`: a member that lies is
  dropped), and one claiming more than 1 000:1 is skipped. Text members are
  read up to 256 KB, documents up to 10 MB (two, 16 MB in all); the worker
  has 384 MB of heap and 45 s.
- **Untrusted names.** `..` segments, absolute paths, drive letters,
  backslashes and NULs are listed with "unsafe name" and never read; links
  and special entries are listed and never followed; control and
  bidirectional characters are replaced before a name is shown.
- **Formats Node can't expand** go through a program this computer has:
  `bzip2 -dc` or `xz -dc` (decompression only), and `bsdtar` (macOS and
  Windows 10+ ship it; Linux has it as `bsdtar`) to turn a 7-Zip, RAR, CAB
  or XAR archive into a tar stream, which the worker then reads. bsdtar is
  only ever given those four, by their binary signatures: given an mtree
  text (bare or compressed), `bsdtar -c @archive` packs the files on this
  computer that it names, so a crafted `.tar.bz2` could read a key into the
  chat (tested). Each program gets the bytes in an empty private folder that
  is then removed, an empty environment, 30 s and 48 MB of output, and on
  macOS runs under `sandbox-exec` with no network, no writes and none of the
  person's files. Without the program, the model is told what the file is and
  that nothing here opens it.
- A document inside is written to a fresh private folder under a name Conch
  chooses, read by the other readers (never this one, so depth is 1) as if
  the engine had neither files nor tools, and removed.

Tests: `readers/archives.test.ts` (formats, ordering, nested
documents, traversal names, a lying ZIP member, a gzip bomb, 100 050
entries, damaged archives, a compressed mtree that must not read a file,
7-Zip and bzip2 through this computer's programs).

### Documents past PDF and Office (`readers/documents.ts`, `files/document-worker.mjs`)

The sealed document reader (the same worker, the same `read_document`) reads,
besides PDF and OOXML: OpenDocument text, sheets and slides (`.odt`, `.ods`,
`.odp`, `.odg`); EPUB; RTF; email (`.eml`, `.mbox`, Outlook `.msg`); Word,
Excel and PowerPoint 97–2003 (`.doc`, `.xls`, `.ppt`); and Jupyter notebooks.
An API model gets the words with the message; an engine that opens files gets
the path and `read_document`, which now takes all of these, so Claude Code and
Codex read a `.msg` or an `.odt` without a converter of their own. Hermes Agent
and OpenClaw hand ODF and legacy Office to LibreOffice and don't parse mail at
all; Conch parses every one of these itself, in JavaScript, in the worker.

- **Shapes for a model.** Headings as `#`, lists as `-`, document tables as
  Markdown. Sheets (XLSX, ODS, XLS) are Markdown tables with the file's
  column letters across and its row numbers down, so "B7" means what it does
  in the file; rows without values are left out; at most 5 000 rows and 256
  columns a sheet (Hermes Agent's caps), said when cut. XLSX dates styled as
  dates read as dates, not day numbers; formulas are shown beside their
  stored value, never run. An EPUB is an "About this book" section (title,
  author, the chapter list), then a section per chapter in spine order, named
  from its NCX or first heading. An email is From, To, Cc, Date, Subject,
  its plain words (or its HTML's), and its attachments by name, type and
  size, never opened; a forwarded message inside is shown under it. A
  mailbox is a section per message. A notebook is its cells in order, code
  fenced, outputs as saved with terminal colours removed and cut at 4 000
  characters, pictures named.
- **Text that is a document.** An `.eml`, `.mbox`, `.rtf` or `.ipynb` is
  usually valid UTF-8, so it's stored as `text`, which `prompt.ts` used to
  inline raw before any reader ran (MIME and base64, RTF control words,
  notebook JSON). A reader may now take text (`Reader.text`); `documents` is
  the only one. It runs only for engines that don't open files; when it
  declines (it isn't an email after all) or fails, the text goes in as before.
  Engines that open files still get the raw text, which they read fine.
- **Older Office files.** The worker reads Word 97–2003 from its piece table
  (field codes dropped, their results kept), Excel 97–2003 from its BIFF8
  records (shared strings across CONTINUE records, numbers, RKs), and
  PowerPoint 97–2003 from its text atoms, all through a compound-file reader
  that checks every sector chain (no loops, nothing out of range). What it
  can't read (Word 95, Excel 95) is converted first when this computer has a
  converter (`files/office.ts`): LibreOffice headless, else macOS `textutil`
  for Word, given the bytes in a private temporary folder that is then
  removed, arguments only, no environment but that folder, a fresh
  LibreOffice profile (macros off), 90 s, and on macOS a Seatbelt profile
  with no network and writes only to temporary folders. The result is read by
  the worker like any DOCX. LibreOffice is a need (`libreoffice`,
  `setup/known.ts`, winget or Homebrew); without it the model is told what
  would read the file and to ask for a DOCX, XLSX, PPTX or PDF.
- **Sniffing.** Extensions map to their types (`sniff.ts`); an EPUB or ODF
  file with a name that says nothing is told by the `mimetype` entry both
  store first in the zip. `READABLE_DOCUMENT_TYPES` lists every type read, so
  the composer no longer warns about them and `binary` leaves them alone.
- **Previews.** Sheets and mail come back as `view` tables and emails, the
  rest as text.

Limits, in the worker: a zip expands at most `min(40 MB, max(10 MB, 100 ×
the file))` and 10 MB an entry (Open WebUI's ratio), checked from the
directory before inflating and again after; XML may not declare entities
(a DOCTYPE naming XHTML's DTD is fine) and nests at most 100 deep
(fast-xml-parser's own cap); ODF's repeated rows and columns are expanded
only as far as they're shown, so a sheet claiming a million rows costs
nothing; RTF groups nest at most 10 000 deep; an email's headers are read to
256 KB, multiparts 8 deep and 200 parts each, forwarded messages 3 deep; HTML
is turned into words in one `indexOf` pass, so a hostile page costs its
length; a mailbox counts at most 10 000 messages. A locked file (ODF
encryption, EPUB DRM other than font obfuscation, encrypted Word, Excel or
PowerPoint, password-protected OOXML) is said to be locked.

Tests: `readers/documents.test.ts` (fixtures built in the test: ODT, ODS
with a million repeated rows, ODP with notes, EPUB with an NCX, a DOCTYPE, a
script and a traversal `href`, DRM and font obfuscation, RTF, a multipart
email with quoted-printable, encoded words and an RFC 2231 name, HTML-only
mail, 3 MB of headers, 40 nested multiparts, hostile HTML, mbox, an Outlook
message, Word, Excel and PowerPoint 97 compound files, a looping FAT, a real
macOS `textutil` `.doc`, a notebook; a zip bomb; per-engine delivery and the
preview), `files/files.test.ts`.

### Previews for every kind (`attachments/view.ts`, Nacre `AttachmentViewBody`)

What the browser can't show by itself is shown from what the readers make of
it. `GET /api/attachments/:id/view` runs the first reader that takes the file
with `can: { images: false, files: false, tools: false }` and 400 000
characters of room (nothing goes to a model), waits at most 20 s (a recording
still being heard comes back with what's done, and the web asks again every
15 s while `more`), keeps the result per attachment (64, most recent; an
unfinished one for 30 s), and runs two readers at once at most. It answers
`{ view: AttachmentView | null }` (`@conch/protocol`): a `summary` sentence and
parts — `text` (headings, paragraphs, items, quotes, set text), `table`
(sheets, database tables; tabs when there are several), `tree` (an archive's
paths), `email` (headers, words, the names of what it carried), `transcript`
(what's said, with seconds; each time plays from there) and `facts` (what a
program or font is). A reader says how to draw it with `ReaderResult.view`;
without one the view is made from its text by the shapes readers write
(`[Sheet: Q3]`, `A1: x | B1: y`, `[0:05] …`, `Title: …`, tab or pipe rows,
paths, mail headers), and the note's first sentence becomes the summary unless
it speaks to a model. A notebook (`.ipynb`) is read in the browser: notes as
words, code highlighted, outputs as plain text, pictures and HTML named only.
`null` (nothing reads it) or a failed view shows what it is: its glyph, kind,
size and type, and **Download**. On a phone the preview's one scroll moves the
whole document, tables scroll sideways, facts stack, and the footer clears
the home indicator.

## Security

Threat model: a web page or another localhost port trying to upload or read
files; a file crafted to run as Conch when shown; a file or paste carrying a
prompt injection; path tricks in names and ids.

- Uploads take `application/octet-stream` only (never multipart or
  `text/plain`, which cross-site forms can send without a preflight), behind
  the existing Host, Origin and Fetch-Metadata checks and sign-in.
- Attachments are served with `nosniff`, a `sandbox` CSP and
  `frame-ancestors 'none'`. Text is always `text/plain` (an attached HTML file
  is shown as source), unknown types download, and only images, PDFs and a
  short list of audio/video types show inline. PDFs are the only thing the
  app may frame (`frame-ancestors 'self'`), because browsers won't render one
  in a sandbox. iOS Safari draws only a framed PDF's first page, so the
  preview also offers **Open** (the same URL in a new tab, `noopener`). Following OWASP File Upload Cheat Sheet: allowlisted types by
  content, generated storage names, size limits, no execution.
- Ids pass `Id` and `safeJoin`; names pass `cleanName`; attribute values in the
  prompt are escaped and bodies can't close their fence.
- The prompt says attachments are material, not instructions (indirect prompt
  injection, Greshake et al. 2023). Only the person's own words are matched
  against integrations, so a pasted page can't raise integration issues.
- The agent can't upload, claim or read attachments through these routes; they
  need a signed-in person.
- Documents of every kind above are parsed only in the sealed worker, from
  bytes on stdin: no file system, processes, network or environment there.
  Only an Office file older than 97 leaves it, for this computer's own
  converter, sealed as `files/office.ts` says.
- A view is plain data checked against `AttachmentView` on both sides and
  drawn by Conch as text: no file's HTML, styles or links are ever rendered,
  and the reply is JSON with `nosniff`, `no-store` and a `sandbox` CSP, behind
  the same sign-in, Host, Origin and Fetch-Metadata checks (tests:
  `attachments/view.test.ts`: 404, traversal, sign-in, cross-site).
- A PDF's pages are drawn in a disposable worker (`files/pdf-worker.mjs`)
  with the same seal as the document reader (read-only to its own code and
  packages, no writes, no processes, no environment, a heap cap and a 60 s
  deadline), with one exception: it may load a native addon
  (`runWorker({ addons: true })`), because `@napi-rs/canvas` is one. Node
  warns that an addon can step around the permission model. pdf.js parses
  the file and decodes its pictures and fonts in JavaScript; only drawing
  calls reach the canvas (Skia, the same that draws untrusted pages in
  Chrome). No other worker asks for addons, and a PDF is looked at only
  when a model would use its pages.
- A PDF is only ever sent to the provider the chat is with. OpenRouter is
  told to let the model read it (`engine: 'native'`) and only models that
  take files get one, so it never goes on to another company's OCR.

Tests: `apps/server/src/attachments/attachments.test.ts` (sniffing, names,
storage, sweep, fencing, per-engine delivery, sandboxed serving, refused
uploads, cross-site, traversal, sign-in), `e2e/attachments.spec.ts`.

## Consequences

- Protocol version 7.
- Sent attachments aren't handed to another provider when a chat moves;
  they're named in the handoff so the person can resend.
- Drafts (typed text and cards) still don't survive a reload.
