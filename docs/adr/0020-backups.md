# 0020 — Backups: your Conch in one file, and back again

- Status: accepted
- Date: 2026-09-30

## Context

Everything a person builds up in Conch lives in `~/.conch` (`CONCH_HOME`):
their settings, memories, commands, routines and run history, skills,
integrations, chats and the files sent in them, and the keys and sign-ins
that make it all work. A broken disk, a bad edit or a new computer meant
starting again. People who have never opened a terminal can't be told to
copy a hidden folder, and a copy of it would carry cookies, caches and
half-written files that don't belong on another machine.

A phone gets this right: it backs itself up every night without being asked,
says “Backed up · Last backup today at 03:12”, and a restore shows what
comes back before it does anything.

## Decision

### What's in a backup: one manifest

`apps/server/src/backup/manifest.ts` classifies **every** path Conch writes
under `CONCH_HOME`, first match wins:

| Class       | What                                                                                                                                                                                                                     | In a backup                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| **kept**    | `settings.json`, `browser.json` (settings, sites you always allow), `terminal.json`, `backups.json`, `usage.json`; `memory/`, `commands/`, `routines/` (+ `.runs.jsonl`), `skills/` + `skills.json`, `integrations.json` | always                                             |
| kept, chats | `conversations/`, `attachments/`, `api-sessions/`, `browser/shots/`                                                                                                                                                      | behind “Include chats” (on by default, size shown) |
| **secret**  | `secrets.json`, `integrations.secrets.json`, `access.json` (who may sign in)                                                                                                                                             | only locked with a passphrase                      |
| **derived** | `search.db*` (rebuilt from the chats), `healed.json`, `gateway.json`, `browser/profile/` (cookies: too sensitive and too big), damaged copies (`*.broken-*`), half-written `*.tmp`                                       | never                                              |
| **outside** | `backups/` (a backup of backups would only grow), `workspace/` (the person's own files, like any folder they point Conch at; a work folder elsewhere isn't in backups either)                                            | never                                              |

The non-obvious ones:

- **`api-sessions/` is kept, not derived.** It's what a model API needs to
  carry a chat on: the provider's own messages verbatim, including signed
  thinking blocks, which can't be rebuilt from Conch's event log. Without it a
  restored API chat would lose its context (the chat records that the
  provider already saw it, so nothing would be handed over again).
- **`usage.json` is kept, and merged on restore.** It holds the budget (a
  setting) and the spending record, which includes chats deleted since and
  so can't be rebuilt. A restore takes the backup's budget and, for each day,
  the larger amount: money already spent stays counted, so a restore never
  makes a budget look further off than it is.
- **`access.json` is a secret, credentials only.** A backup keeps the method,
  username, password hash and access-key hashes — never signed-in devices or
  pairing codes, which could bring back a device you signed out since. A
  restore keeps the device restoring signed in and signs every other one out,
  as changing a password does.
- **`browser/shots/`** are the thumbnails a chat shows for each browser step,
  so they travel with chats. The browser's profile (cookies, sign-ins to
  websites) never does.

`manifest.test.ts` runs a whole Conch in a temp home through the real
services (settings, a memory, a command, a routine that ran, skills, an
integration with its token, a chat with an attachment, a browser thumbnail,
a model API transcript, a budget, a password, a provider key, a backup) and
**fails on any file no rule covers**. AGENTS.md makes this a rule for every
new store.

### Format

`Conch backup 2026-09-30.conchbackup` is a POSIX tar (ustar, pax names for
long or non-ASCII paths) inside gzip, written and read with Node's own zlib:
no new dependency, and any `tar -xzf` opens it, so a backup is never locked
in Conch. In order:

1. `conch-backup.json` — format and version, when, the Conch that made it,
   its kind, the groups it holds, counts for the preview (“12 memories · 3
   routines · 5 integrations · 240 chats”), and how the keys are locked;
2. `files/<path>` — each kept file by its path under `CONCH_HOME`;
3. `seal.json` — each file's size and SHA-256;
4. `secrets.enc` — keys and sign-ins, when they're in it.

A newer format is refused in a plain sentence (“This backup was made by a
newer Conch. Update Conch, then restore it.”); older ones pass through a
table of migrations, and one older than the oldest this Conch can read is
explained. Format 1 is the first.

### Crypto (keys and sign-ins only, `node:crypto` only)

- scrypt, N=2^17, r=8, p=1 (OWASP Password Storage Cheat Sheet), over a
  random 128-bit salt (NIST SP 800-132), with the passphrase NFKC-normalised —
  the same `auth/secrets.ts` code as password hashing;
- HKDF-SHA256 (RFC 5869) splits that into an encryption key and a check key;
  an HMAC of a fixed text with the check key tells a wrong passphrase apart
  from a changed file;
- AES-256-GCM with a random 96-bit nonce (NIST SP 800-38D; each key encrypts
  once), with the SHA-256 of the header and of the seal as associated data:
  changing the header, the file list or any sum makes the keys not open
  (OWASP Cryptographic Storage Cheat Sheet: authenticated encryption, no
  home-made MACs).

The passphrase is typed twice and held to the same strength check as
passwords (`checkPassword`, 15+ characters), never stored, never hinted,
never logged, and only ever sent in a request body. Taking keys out of Conch
needs a recent sign-in. Forgetting it isn't a dead end: everything else
restores without it.

Without a passphrase, the seal catches damage and naive tampering, not a
forger who rewrites the sums too; that's why keys are never in a backup
without one, and why the Undo copy (below) never leaves this computer.

### Automatic backups

Once a day, into `CONCH_HOME/backups/`, when nothing is busy (no turn, no
title, no permission waiting, and five quiet minutes in every chat). On by
default, local only, chats included, keys not (they're already on this disk).
Seven dailies and four weeklies before them are kept (`retention.ts`). Before
writing, Conch checks there's room (`statfs`); if there isn't, it says so in
one sentence and tries again later. Repair everything's `backups` check says
“Backed up today” (ok), “No backup for 9 days” (warning; the repair makes one
now), or “Daily backups are off” (off, nobody's problem).

### Restore

1. **Preview first.** Choosing an automatic backup, or uploading a file, shows
   what comes back in plain words and what stays as it is (“Keys and sign-ins
   aren't in it · yours stay as they are”), with the passphrase when there
   are locked keys. One dialog, one primary button.
2. **Restore** needs a recent sign-in (sudo mode). The whole file is checked
   — every entry, path, size, sum and the passphrase — into a staging folder
   inside `backups/`; nothing in the live home is touched until it passes.
   Then what the restore replaces is saved as a **Before restoring** copy
   (keys included, unlocked, `0600`, never downloadable and never accepted
   from an upload), and `plan.json` is written last.
3. **Conch starts again** (`restart()`, when it runs under `pnpm start`); the
   page shows “Restoring your Conch… Your chats are safe” and comes back by
   itself, with **Undo** in a toast and in Settings. Where Conch can't start
   itself, the page says to restart it, and Settings offers **Restart now**
   or **Cancel restore** while it waits.
4. The files go into place in `main.ts`, **before any store reads anything**,
   so nothing running can write over them. The Undo copy is made again at that
   moment (what changed while the restore waited is kept too). A group is
   replaced whole, so what was added since goes (and Undo brings it back);
   groups the backup doesn't hold, like chats when they were left out, and
   keys it doesn't have, stay as they are. The search index is dropped and
   rebuilds from the restored chats. A restore cut short by a crash is
   finished on the next start: clearing and copying again gives the same
   result.

### Restore safety

Following OWASP ASVS 5.0 V5 (File Handling: compressed files are checked
against a maximum unpacked size and file count before unpacking, 5.2.3, and
unpacking ignores paths it doesn't trust, 5.3.3), the File Upload and Input
Validation Cheat Sheets, and the “Zip Slip” research (Snyk, 2018):

- **Paths** are relative with `/` only; no `.`/`..` parts, drive letters,
  `:` (streams), backslashes, control characters, Windows device names,
  trailing dots or spaces, or short names (`NOTES~1.MD`). Each part goes
  through `safeJoin`, and the result is checked to be inside its root.
- **Only what the manifest keeps** can be restored, and only into a group the
  header declares: a backup can't write into `backups/`, `workspace/`, the
  browser profile, or anything Conch doesn't know. Unlocked keys are only
  accepted from an Undo copy this computer made.
- **Only regular files.** Links (hard or symbolic), folders, devices, pipes,
  GNU long names and global pax headers are refused; tar header sums are
  checked; nothing but zeros may follow the end. Staged files are opened
  with `wx`, so nothing is written through something already there.
- **Limits** (`BACKUP_LIMITS`): 2 GB uploaded (streamed to disk, cut off at
  the limit), 8 GB unpacked, 1 GB a file, 250,000 files, 512-character paths;
  a bomb stops at the cap. A crafted lock can't ask scrypt for more than
  512 MiB.
- **Uploads** reuse the attachments road (ADR 0017): raw
  `application/octet-stream`, which a cross-site form can't send without a
  preflight, behind the gateway's Origin, Fetch-Metadata and sign-in checks.
  An upload that isn't restored from is thrown away, and any left behind are
  swept after an hour.
- **Errors** are sentences a person can act on; nothing on the page ever
  holds a path or a system error.

Every one of these has a test: `format.test.ts` builds hostile archives by
hand (traversal, absolute paths, links, bombs, tampering, a wrong
passphrase, newer and older formats), `backup.test.ts` restores a used Conch
onto a fresh one and undoes it, and the routes' sudo requirement is checked.

## Consequences

- A person gets a daily safety net without doing anything, and moving to a
  new computer is one file.
- Every new store must be classified in `backup/manifest.ts`; the coverage
  test fails otherwise.
- Automatic backups take disk space: up to eleven copies of everything kept,
  compressed. Settings shows how much.

Known limits:

- Claude Code and Codex keep their own sessions outside Conch (`~/.claude`,
  `~/.codex`). On another computer a restored chat is all there to read, but
  those providers may not remember it when it carries on.
- Files in the work folder aren't in backups.
- A backup without a passphrase is as trustworthy as where it came from:
  the seal catches damage, not a determined forger. Restore files you made.
- The browser's sign-ins to websites aren't backed up; sign in again there.
