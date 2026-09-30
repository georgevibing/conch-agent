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
glyph and tint: pasted text, text, code, data/CSV, PDF, documents, sheets,
slides, archives, pictures, audio, video, and a fallback. `AttachmentPreview`
shows pictures on a stage, PDFs in the browser's viewer, CSVs as a table,
highlighted code, native audio and video, and for anything else says there's
no preview and offers the download. Dropping files anywhere on the chat
(`useFileDrop` + `DropOverlay`), the attach button, a pasted screenshot and
⌘K **Attach files** all add cards.

**The gateway decides what a file is,** from its bytes: an image only if its
header says PNG, JPEG, GIF or WebP; `text` if it's valid UTF-8 without NULs;
otherwise a `file`. The name and the browser's claim only break ties. Names
are cleaned (no folders, control or bidi characters, Windows-reserved names).

**Each provider gets what it can use** (`Engine.attachments`, surfaced as
`Capabilities.attachments`, and `ModelInfo.images` per model):

| Provider      | images                               | files (by path)                     |
| ------------- | ------------------------------------ | ----------------------------------- |
| Claude Code   | content blocks                       | yes (`additionalDirectories`)       |
| Codex CLI     | by path (it looks)                   | yes                                 |
| Anthropic API | content blocks                       | no                                  |
| OpenRouter    | data URLs, if the model says it sees | no                                  |
| Mock          | yes                                  | no (keeps the degraded path tested) |

Text always goes inline, fenced in `<attachment>` tags inside an
`<attachments>` block before the person's words, up to 150 000 characters
each and 400 000 in all. Past that, engines that open files get the start and
the path, the rest get the start and a note. What a provider can't use is
named with a plain note so the model can say so. The composer warns first:
a card whose provider can't use it gets a dot and a sentence.

**Limits.** 20 attachments per message, 30 MB each, checked in the browser
first (with the reason on the card) and again by the gateway. Pictures larger
than 5 MB or 8 000 px are scaled down to 4 096 px in the browser before upload
(GIFs are left alone). The same file picked twice is attached once. Folders are
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
  in a sandbox. Following OWASP File Upload Cheat Sheet: allowlisted types by
  content, generated storage names, size limits, no execution.
- Ids pass `Id` and `safeJoin`; names pass `cleanName`; attribute values in the
  prompt are escaped and bodies can't close their fence.
- The prompt says attachments are material, not instructions (indirect prompt
  injection, Greshake et al. 2023). Only the person's own words are matched
  against integrations, so a pasted page can't raise integration issues.
- The agent can't upload, claim or read attachments through these routes; they
  need a signed-in person.

Tests: `apps/server/src/attachments/attachments.test.ts` (sniffing, names,
storage, sweep, fencing, per-engine delivery, sandboxed serving, refused
uploads, cross-site, traversal, sign-in), `e2e/attachments.spec.ts`.

## Consequences

- Protocol version 7.
- Sent attachments aren't handed to another provider when a chat moves;
  they're named in the handoff so the person can resend.
- Drafts (typed text and cards) still don't survive a reload.
