# 0111 — Your past chats from other apps

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0035](./0035-come-home.md) and [ADR 0042](./0042-come-home-the-rest.md)
  (come home), [ADR 0007](./0007-search.md) (search), [ADR 0059](./0059-looking-through-earlier-chats.md)
  (looking through earlier chats), [ADR 0069](./0069-carrying-a-chat-on.md) (carrying a chat on),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading), [ADR 0087](./0087-the-memory-check.md)
  (the memory check), [ADR 0088](./0088-quiet-learning.md) and [ADR 0097](./0097-proactive-memory-maintenance.md)
  (learning), [ADR 0020](./0020-backups.md) (backups), [ADR 0051](./0051-releases.md) (data across versions)

## Context

Most people who arrive at Conch have talked to a coding agent before: Claude Code,
Codex, Gemini CLI, OpenCode, Copilot in VS Code, OpenClaw or Hermes. Months of
decisions, plans and fixes sit in those apps' folders, out of reach of the chat
they now use. Come home (ADR 0035) brings OpenClaw's and Hermes's memories,
skills and agents, but not what was said.

Others have started on this. OpenClaw has `openclaw sessions import` for Claude
Code and Codex sessions; Hermes can resume one (`hermes --resume @claude`). Both
ask for the command and, often, a path. Conch's promise is that nobody types a
path: Conch finds them, says what it found, and brings them with one press.

Each app keeps its chats its own way, and the shapes move. In the last year:

- **Claude Code**: `~/.claude/projects/<folder>/<session>.jsonl` (`CLAUDE_CONFIG_DIR`),
  a line per event; one reply can span lines sharing `message.id`; titles in
  `ai-title`/`custom-title`/`summary` lines; `isMeta`, `isSidechain` and the
  `<synthetic>` model are its own; helpers' transcripts sit under `subagents/`.
- **Codex**: `~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl` (`CODEX_HOME`),
  `{timestamp, type, payload}` lines (`session_meta`, `turn_context`,
  `response_item`, `event_msg`); older ones squeezed to `.jsonl.zst`; before that,
  bare items, or one `.json`; titles in `session_index.jsonl`.
- **Gemini CLI**: `~/.gemini/tmp/<project>/chats/session-….jsonl`, an append-only
  change log (a later line with the same `id` replaces one; `$set`, `$rewindTo`,
  `$patch`); before, a whole `session-….json`. `projects.json` names projects;
  older installs used a hash of the path.
- **OpenCode**: now SQLite (`~/.local/share/opencode/opencode.db`: `session`,
  `message`, `part`); before, the same shapes as files under `storage/`.
- **OpenClaw**: now one SQLite file per agent (`session_windows`, `session_nodes`,
  `transcript_events`, some events zstd-compressed); before, `sessions/<id>.jsonl`.
  Transcripts are Pi's format.
- **Hermes**: SQLite (`~/.hermes/state.db`: `sessions`, `messages`; a reply may
  live only in `codex_message_items`), one per profile.
- **Copilot Chat** (VS Code): `workspaceStorage/<id>/chatSessions/<id>.json`, and
  since VS Code 1.109 a `.jsonl` log of changes to the same object.
- **Cursor** keeps its chats in `state.vscdb` key-value rows of its own shape.

These were read from each project's source and documentation (claude-code's
on-disk files, `codex-rs` `rollout`/`protocol`, `gemini-cli`'s
`chatRecordingService`, `opencode`'s `storage`/schema, OpenClaw's schema and
`docs/concepts/session.md`, Hermes's `docs/developer-guide/session-storage.md`,
VS Code's `chatSessionStore`). Those formats are someone else's and will drift.

The text is someone else's too. A transcript holds what a coding agent read:
web pages, issues, emails, files, any of which can carry words written to steer
a model (Greshake et al., 2023, indirect prompt injection; OWASP Top 10 for LLM
Applications 2025, LLM01). It holds keys pasted months ago (LLM02, sensitive
information disclosure). And a file on disk can be edited by anything that runs
as the user: what it says isn't proof the person said it (ADR 0087).

## Decision

**Find them, bring them in with one press, keep them apart from Conch's own
chats, find them with everything else, and carry one on with the same app.**

### 1. Found, never asked for

`import/chats/` has one reader per app (`claude.ts`, `codex.ts`, `gemini.ts`,
`opencode.ts`, `copilot.ts`, `openclaw.ts`, `hermes.ts`), each a `ChatFinder`:
`find()` lists that app's chats cheaply (names, sizes, a peek at a file's first
bytes for its folder, a `SELECT` of a database's session rows), and `read()`
reads one. Each looks where its app looks, honouring the app's own variable
(`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `XDG_DATA_HOME`,
`OPENCODE_DB`, `OPENCLAW_STATE_DIR`, `HERMES_HOME`) and, for VS Code, each
system's settings folder and edition. When `CONCH_IMPORT_HOME` points at a
pretend home (tests, the journeys), the real environment is ignored, so no test
sees whoever runs it.

`ChatImportService.status()` is the look: per app, how many, how many are new
or grew, the projects with the most and since when. It's kept for a minute, so
Settings can ask on every open.

### 2. Tolerant readers

Every reader reads loosely and fails small:

- **Streamed.** JSONL is read a line at a time (`jsonLines`, through zstd where
  needed): a session of hundreds of megabytes never sits in memory. A line over
  4 MB is a tool's output and is skipped unparsed. On a real home of 105
  sessions (791 MB), the whole import took 0.75 s.
- **A line that won't parse is skipped** (a crash mid-write); a file that throws
  is counted as skipped and the rest still come.
- **Databases are opened read-only**, with a short busy wait, and asked only for
  the columns they have (`PRAGMA table_info`): one query for every version. A
  database that won't open is nothing, never a failure.
- **Every shape we know of each app is read**, old and new (§ Context), and each
  has a fixture written in its own app's shape (`fixtures.ts`, `chats.test.ts`).
- **Words only.** What the person said and what the assistant answered. Tool
  calls, their results, pictures and thinking are steps, not what was said, and
  stay out; so does what a program put in a turn (`<system-reminder>`,
  `<command-name>`, `<environment_context>`, AGENTS.md preambles). Messages are
  cut at 24,000 characters and a chat keeps its last 4,000 messages.
- **Not yours stays out**: a helper's own session, a routine's run, a group's or
  a channel's shared session, a subtask. So do the Claude Code sessions behind
  Conch's own chats (`ownSessions`: every `resumeId` the conversation store
  holds), which are already chats here.
- **A log of changes can't reach a prototype**: Copilot's `.jsonl` paths that
  name `__proto__`, `prototype` or `constructor` are dropped (tested).

### 3. Kept apart, in Conch's own shape

Past chats live in `~/.conch/past-chats/`: `index.json` lists them (source, the
app's id, the file and its size and time, title, project, dates, count, model),
and `<id>.jsonl` holds each as the same `ConversationEvent`s a chat of Conch's
own logs (`title`, `user.message`, `assistant.delta`, `assistant.done`).

- **Not in the chat list.** Thousands of other apps' sessions would bury the
  person's own chats, and `conversations/index.json` (rewritten on every change)
  would grow with each. They're found, not listed.
- **The same chat brought twice is one chat.** A past chat's id is
  `pc_` + 16 hex of `sha256(source, the app's id)` (`PastChatId`,
  `isPastChatId`), so bringing it again overwrites it.
- **Only what's new.** A chat is read again only when its file's size or time
  changed (a database session: its updated time and count). The list is written
  every 25 chats, so a crash mid-way loses little.
- **The logs are the truth.** A damaged list keeps what's still good (`readStore`)
  and lists a lost log again from what it says: its message ids carry their app
  (`claude-code.3`). Healed and noted: "Rebuilt the list of chats you brought in".
- **Data across versions (ADR 0051).** A new folder; nothing an older Conch
  reads changes. An older Conch ignores it.
- **Whole Conch.** A backup rule (`past-chats/**`, `kept`, in the `chats` group:
  if the other app is gone, this is the only copy); `lib/protect.ts` keeps the
  assistant's file tools out (a line written into one would read as something
  you once said); a Repair everything check (`pastChatsCheck`: the list reads,
  chats waiting, and with Repair, the new ones brought in).

### 4. Secrets out on the way in

Every message and title passes Passwords' redactor and `scrubSecrets`
(ADR 0059 §4) before it's written: keys by shape (`sk-…`, `ghp_…`, `AKIA…`,
private keys, JWTs, `Bearer …`, `user:password@`) and values after
`password:`/`token=`. How many were taken out is counted and said. What reaches
the disk, the index, the assistant and the screen is the redacted text; the
search tools redact again when they read (ADR 0059), for a password Passwords
learns later.

### 5. Found with everything else, as from outside

The search index's source is Conch's chats and the past chats together
(`Services`, `pastSummaries`), and `SearchService.refresh()` catches up after
each batch, so ⌘K, `search_chats` and `read_chat` find them like any chat.
`ChatFacts` gains `place` ("Claude Code, in shop", shown as `from`), and every
past chat's facts carry an `app` taint named for its app: results are marked
`untrusted`, and bringing their lines into a chat taints it (`your chat
“…”`), so anything risky asks first in every mode that asks after reading
(ADR 0028, ADR 0100 § Auto).

### 6. Never learned from by itself

Imported text is untrusted, so nothing in it becomes a memory on its own.
Quiet learning (ADR 0088) and the tidy-up (ADR 0032) read only Conch's own
conversation store, which past chats aren't in. A memory the assistant writes
after reading one goes through the memory check with the chat's taint, as
after any outside reading (ADR 0087). A carried-on chat (§7) starts tainted,
and `QuietLearning.broughtIn` marks everything it brought as already reviewed,
so learning reads only what's said there next (ADR 0097's exclusion of what
isn't the person's).

### 7. Carry one on with the same app

A past chat opens in a sheet beside where the person is (Nacre
`PastChatReader`), with **Carry on here**. `ConversationManager.adopt` starts a
chat of Conch's own with its messages (redacted again on the way), an `app`
taint for where they came from, and the provider that matches: Claude Code for
Claude Code, Codex for Codex, Gemini CLI for Gemini CLI, Copilot for Copilot
(`CARRY_ON_WITH`), when connected; otherwise the default. Nothing runs. The
next message is answered with the conversation so far handed over (ADR 0069).

The provider's own session is **not** resumed. Resuming Claude Code's session
would append to the file in `~/.claude` (the SDK resumes in place), and only from
the folder it was started in; Codex's would need the person's `CODEX_HOME`, not
Conch's. Come home's rule holds: the other app's folder is only read. A fork
of the native session (the Agent SDK's `forkSession`) is the way to add it later.

### 8. One moment, then by itself

- **The moment** is Nacre `ChatsFound`: every app's mark gathered by the pearl,
  light flowing into it, the count turning up on its wheels (`Odometer`,
  `useCountUp`) to "Found 1,284 conversations", "from Claude Code and Codex.
  Bring them in?", each app's count, busiest projects and since when, then
  **Bring them in**. While they come in the light quickens and a bar fills; when
  they're here the pearl glows and the next thing to try is one press (**Search
  them**). Reduced motion: the count simply is, nothing travels.
- **Offered on the new chat** (one quiet line under the composer, only when there
  are some and none have been brought in yet; ADR 0068 amended, it was a step of
  the welcome), and in **Settings → Memory → Your past chats**, which ⌘K finds
  by the apps' names. Nothing at all for someone who never used another app.
- **Bringing them in grants nothing**, so it needs only the page's sign-in.
  **Take them out** removes things, so it asks, then needs a recent password or
  key (sudo mode).
- **By itself after that.** Once a person has brought chats in, `keepUp` brings
  new ones from the same apps two minutes after start and every six hours, and
  says nothing unless asked. An app never brought from is never read by itself.

### Routes

`GET /api/import/chats` (the look), `POST /api/import/chats` (start; answers 202
with the look, which then carries `running`), `DELETE /api/import/chats` (sudo),
`GET /api/past-chats`, `GET /api/past-chats/:id`, `POST /api/past-chats/:id/continue`.
Shapes in `@conch/protocol` `chat-import.ts`.

## Consequences

- "What did we decide about checkout in Claude Code?" works in any chat, with
  any provider, from the first day, with nothing to set up.
- The chat list stays the person's own; past chats are a search away.
- A planted line in an old transcript can inform, but can't quietly steer: the
  chat that reads it asks before anything risky, and it never becomes a memory
  without the check.
- **Known limits:**
  - Formats drift. A shape not seen yet is skipped and counted, never a failure;
    a new one is a new branch in its reader and a fixture.
  - Copilot's `.jsonl` change log is read from VS Code's operation shapes as far
    as they could be confirmed (`kind` 0–3); a change it doesn't know is skipped.
  - Cursor isn't read: its chats are rows in a key-value database of its own
    undocumented shape.
  - Carrying on hands over the conversation as words; the provider's own session
    (its tool state, its cache) starts afresh.
  - Secrets are caught by shape and by Passwords; a bare password with no label
    can't be told from a word.
