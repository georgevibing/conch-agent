# 0035 — Come home: bring your things from OpenClaw and Hermes

- Status: accepted (extended by [ADR 0042](./0042-come-home-the-rest.md); the persona rows are now agents, ADR 0042 § Update)
- Date: 2026-10-01
- Builds on: [ADR 0013](./0013-skills.md) (other agents' skill folders),
  [ADR 0018](./0018-channels.md) (chat bots and the owner's hello),
  [ADR 0020](./0020-backups.md) (backups before a change),
  [ADR 0028](./0028-safe-hands.md) (skills read first)

## Context

People who come to Conch have often lived with another assistant for months.
OpenClaw or Hermes Agent knows their name and their habits. It has skills
they wrote and morning briefings that run on a schedule. It has a Telegram
bot their family talks to. Starting from nothing means losing all of it, so
most people never switch.

Neither app has an export. Their files are documented, though, and they sit
in your home folder:

- **OpenClaw**, in `~/.openclaw`. Older installs used `~/.clawdbot` or
  `~/.moltbot`.
  - `openclaw.json` (JSON5): the workspace, the channels' keys and an `env`
    block.
  - The workspace: `SOUL.md`, `IDENTITY.md`, `USER.md` and `MEMORY.md`, daily
    notes in `memory/YYYY-MM-DD.md`, and `skills/`.
  - Elsewhere in `~/.openclaw`: `skills/`, `cron/jobs.json`, `.env` and
    `agents/main/agent/auth-profiles.json`.
- **Hermes**, in `~/.hermes`.
  - `SOUL.md`.
  - `memories/MEMORY.md` and `memories/USER.md`, with entries separated by
    `§`.
  - `skills/<category>/<name>/`.
  - `cron/jobs.json`, with schedules such as "every 2h", a cron line or a
    time.
  - `.env`, holding bot tokens and provider keys.

These files are also an attack surface. A memory file is text the
assistant will believe. A skill from a public registry may be malicious
(the ClawHavoc campaign planted such skills on ClawHub). A bot token or an API key is a secret. An import that
copies all of it silently would import someone else's prompt injection
along with your keys.

## Decision

**Look, then bring, then Undo if you want.** Each step is the person's
choice.

### 1. Look: a plan of everything, read-only

`ImportService.plan(source)` reads the folder and lists what could come
over. Each thing has a title, where it came from, its words behind "Show
what it says", and a tick. The reading follows these rules:

- **Read-only, and links aren't followed.** `read.ts` checks every path with
  `lstat`. A symlink, a FIFO or a file over 1 MB is skipped. A link planted
  in a skill folder doesn't come over (`cp` with a filter that drops links
  and dot-files, at most 200 files and 10 MB).
- **Problems are sentences.** A damaged `openclaw.json` gives "…couldn't be
  read, so its settings stay behind", and everything else still comes. A
  cron schedule Conch can't read leaves that one routine out.
- **No secret reaches the plan.** Bots and keys appear by name ("Your
  Telegram bot") and never by value. Tests check the plan's JSON for every
  fixture secret.

What starts ticked:

| Thing                            | Ticked?                                | Comes over as                                                                                                                                                |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name (IDENTITY.md)               | Only if yours is still "Conch"         | The persona's name                                                                                                                                           |
| SOUL.md                          | Only if you've written no instructions | Instructions. It replaces yours, says so, and Undo puts yours back                                                                                           |
| USER.md                          | Yes, unless it's already there         | Added to About you                                                                                                                                           |
| Memories                         | Yes. Duplicates and daily notes aren't | Memories                                                                                                                                                     |
| Skills                           | Yes, unless the review says `danger`   | A copy in `~/.conch/skills`, **off**                                                                                                                         |
| Cron jobs                        | Yes                                    | Routines as **drafts** (`trust: ask`). Nothing runs until you turn it on                                                                                     |
| Telegram, Discord and Slack bots | **Never**                              | A channel. `ChannelService.create` checks the key with the app; then it waits for the owner's hello (ADR 0018). The warning says to stop the other app first |
| Anthropic and OpenRouter keys    | **Never**                              | Conch's encrypted key file (`providers.setKey`), checked with the provider, and only if Conch has no key for it yet                                          |

**Words that could steer the assistant are read first.** Persona, about you,
memories and routine prompts all go through `scanText`, which applies ADR
0028's rules. Anything that reads like orders to the assistant starts
unticked, with what Conch found: "ignore previous instructions", sending to
a drop box, reaching for `~/.ssh`, or invisible characters. Invisible
direction-changing characters are removed from anything brought over, even
when ticked. Skills get the full `scanSkill` review.

**Claude Code's own memory stays where it is.** `~/.claude/CLAUDE.md` and
project `CLAUDE.md` files are read by the Claude Code engine itself (ADR
0010). Copying them into Conch's memory would give every Claude Code chat
the same instructions twice. Skills in `~/.claude/skills` are already read
in place (ADR 0013).

### 2. Bring: a backup first, then one at a time

`run(source, ids)` works through these steps:

1. It takes the source's last plan, so exactly what was shown comes over.
2. It runs `backupNow()` first (ADR 0020), as a restore point for everything.
3. It brings each ticked item over in order, broadcasting `import.progress`
   (`done`, `total`, `current`).
4. It records what it added in `~/.conch/import.json`: ids, skill names and
   providers, never values. This file is classed `derived` in the backup
   manifest.

An item that fails becomes an outcome with a sentence, for example
"OpenRouter refused your key", and the rest still come.

The summary (`ImportSummary`) shows four things:

- what came over, by kind;
- what to do next, such as "Say hello to @pearl_bot in Telegram to finish"
  or "The routine is a draft: turn it on in Routines";
- what didn't come over, and why;
- that Conch backed itself up and the other app's folder wasn't changed.

Bringing things over and Undo both need a recent sign-in (sudo mode),
because they can connect a bot and save keys.

### 3. Undo: precise, for a week

`undo()` reads the ledger:

- it removes what the import added (memories, skills, routines, channels,
  keys);
- it puts back what it replaced (persona, about you);
- something you've already removed by hand is skipped quietly.

Restoring the backup would also work, but it needs a restart and rolls back
everything else you did since. The ledger takes back only the import. Undo
is offered in Settings for seven days. After that, what came over is simply
yours.

### Where it shows

- **The new chat.** When another assistant is here and nothing has come over
  from it yet, one quiet line under the composer says "Bring your things from
  OpenClaw" and opens its page in Settings → Memory. It never appears for
  people who have nothing to bring. (It was a screen of the welcome until ADR
  0068 was amended to keep first run to three screens.)
- **Settings → Memory → "Bring your things from another assistant"**: an
  `ImportOffer` card for each app found, and Undo for the last import.
- **⌘K**: "Bring your things from OpenClaw or Hermes" (import, migrate,
  openclaw, hermes, …).
- **Repair everything**: a quiet `off` item, "OpenClaw is on this computer",
  with Take a look, until you've imported once.
- **`pnpm conch import --from openclaw|hermes [--dry-run]`**. `--dry-run`
  lists everything with its tick and changes nothing. Without it, the
  command brings the ticked things over, but never bots or keys, which need
  the app's checks. It refuses while Conch is running, so stores don't race;
  you use Settings instead.

### Testing

The unit tests use fixture homes (`import/fixtures.ts`) modelled on the
documented formats. They include a link out of the folder, a malformed
config, a danger skill, a memory that gives orders, invisible characters,
legacy folder names and `§` memories.

`CONCH_IMPORT_HOME` points the service at a fixture home. The `import` e2e
scenario (port 4370) uses one for the whole journey: the onboarding offer,
the preview, bringing things over, the summary, Undo, and the CLI dry run.

## Consequences

- Moving to Conch takes about a minute and loses nothing you chose to keep.
  You see everything before it comes, and you can take it all back.
- **Imported content is untrusted until you tick it.** The tick is the
  person reading the words. What reads like orders, or worries the scanner,
  isn't ticked for them.
- **Secrets never move silently.** They aren't in the plan, they aren't
  logged, and they aren't in the ledger. A key is checked by its provider
  before it's kept. A bot is checked by its app, and then waits for its
  owner.
- **Known limits:**
  - The formats are undocumented contracts. A future OpenClaw that moves a
    file would make that part stay behind, with a sentence. The parsers fail
    per item, never as a whole.
  - Hermes's `config.yaml` (model choice), OpenClaw's agents beyond `main`
    and a Slack bot with only one of its two keys now come over too: see
    [ADR 0042](./0042-come-home-the-rest.md), and its own known limits.
