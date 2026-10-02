# 0019 — Updates: quiet checks, one-click updates, Conch updating itself

- Status: accepted (amended by [ADR 0051](./0051-releases.md): Conch's own updates now follow signed releases, made ready beside the running version)
- Date: 2026-09-30

## Context

Conch runs from a git checkout (`pnpm start`) and leans on programs it doesn't
ship: Claude Code, Codex, the 1Password CLI, uv. Until now, staying current
meant knowing that `git pull`, `pnpm install` and a rebuild were due, and that
each program had its own updater. That's a terminal chore, and the Conch
promise is that nobody needs a terminal. It was also invisible: nothing said
an update was waiting, or what it would bring.

An updater can do real harm, though. It changes code that runs as you, it can
lose local edits, and a half-applied update can leave Conch unable to start.
So this is as much about what Conch refuses to do as about what it does.

## Decision

### Looking, quietly

- `UpdatesService` (`apps/server/src/updates/`) looks once a day in the
  background: never in the first minute after start-up, a day after the last
  look give or take an hour of jitter, and on **Check now**. Nothing waits on
  a look. What it found is kept in `~/.conch/updates.json`, so the answer is
  there at once after a restart; a damaged file starts again with a note.
- **Conch itself.** The checkout is found from the gateway's own location
  (the nearest folder with `pnpm-workspace.yaml` and `.git`; `CONCH_CHECKOUT`
  overrides it for development and tests only). A look fetches the branch's
  upstream with a 60-second limit, `GIT_TERMINAL_PROMPT=0`,
  `GCM_INTERACTIVE=never`, `credential.interactive=false`, an empty askpass,
  and `ssh -o BatchMode=yes` unless you set your own SSH command. A network or
  sign-in failure is one quiet sentence ("couldn't reach the internet", "GitHub
  asked for a sign-in"), never a prompt. It counts the commits waiting and
  turns the newest subjects into "What's new": conventional prefixes dropped,
  `chore`/`test`/`docs`/`ci`/`build`/`refactor` and merges left out.
- **Programs.** A need (ADR 0016) that can say its `version(path)` (its
  `--version`) and its `latest(path, platform, lookup)` is listed. The newest
  version is asked of where the copy came from — the same judgement as
  updating it (`installedBy` in `setup/known.ts`):

  | Installed by                            | Newest version from                                          |
  | --------------------------------------- | ------------------------------------------------------------ |
  | winget (`…/WinGet/…`)                   | `winget show --id <id> --exact --source winget` → `Version:` |
  | Homebrew (its prefix, Cellar, Caskroom) | `brew info --json=v2 [--cask] <name>`                        |
  | its own installer (`claude update`)     | the npm registry, whose releases it follows                  |
  | anything else                           | `https://registry.npmjs.org/<pkg>/latest`                    |

  A need that can't say its version, or whose newest version Conch never
  learnt, isn't listed. A lookup that fails leaves the last answer standing.

### Updating a program

One press runs the existing `Setup.update` (the way it was installed, with the
installer's progress), one program at a time. The new version is read back;
whatever uses the program looks again (`Services.needLanded`). A copy of Claude
Code from its own installer now updates itself (`claude update`) instead of
gaining a second copy from npm.

**Automatic updates** are an opt-in switch ("Keep the programs Conch uses up
to date"). When on, programs update by themselves between 2 and 5 a.m. local
time, only while no chat or routine is running, and leave a "Fixed on its own"
note. A version that failed isn't tried again every night. It never applies to
Conch itself: that restarts, so it always asks.

### Updating Conch itself

1. **Refuse** when it could lose anything, and say why with the exact commands
   to run by hand: local changes to tracked files, no branch, no upstream,
   commits of its own upstream doesn't have (a merge would be needed), no git
   or no pnpm. It also waits while a chat is working, so nothing is cut short.
2. **Remember HEAD**, then fetch.
3. **Move forward only**, to exactly the upstream commit that was checked:
   `git merge --ff-only --no-overwrite-ignore <sha>`. The check reads
   `@{upstream}` once, as a commit, and the counts, "What's new" and the
   merge all use that one commit: a fetch landing in between (the daily
   check, a terminal) can't change what arrives, so what "What's new" listed
   is what arrives. `--no-overwrite-ignore` keeps a file git ignores (a
   `.env`, your own notes) from being replaced by one the new version adds:
   git stops instead, and Conch refuses in plain words, naming the file to
   move.
4. `pnpm install --frozen-lockfile` ("Installing", with pnpm's own progress).
5. `pnpm --filter @conch/web build` ("Getting the new look ready").
6. **Restart.** Under `pnpm start`'s supervisor, `restart()`: the page shows
   "Updating Conch… This takes a few seconds. Your chats are safe", reloads
   when a new boot id answers, and opens Settings → Health again on "Conch is
   up to date · Updated just now". Otherwise: "Restart Conch to finish: stop
   it and run pnpm start".

**Rollback.** If step 3, 4 or 5 fails, Conch goes back to the remembered HEAD.
`git reset` is only safe because step 1 refused local changes, so that is
checked again first; `git reset --keep` (not `--hard`) refuses by itself
rather than lose a file, and HEAD must still descend from the remembered
commit. Then it reinstalls, and rebuilds the web app if the build had started
(a failed Vite build leaves `dist/` half empty). It says what happened in one
sentence ("The update didn't install (the new version wouldn't build), so Conch
went back to the version you had.") and offers **Try again**. If going back
fails too, it stops touching the folder and shows the commands to finish by
hand.

### Where people see it

Settings → Health → Updates (Nacre `SoftwareUpdate` and `ProgramUpdates`),
Repair everything's `updates` check (a `warning` per update with its one
action; never Conch's own update), and ⌘K ("Check for updates", "Update
Conch"). The only ambient signals are a dot on the sidebar's Settings button
and on the Health tab, and an "Update available" line at the top of Health.
No toasts, no modals.

### Routes

`GET /api/updates`, `POST /api/updates/check`; `POST /api/updates/conch`,
`POST /api/updates/programs`, `POST /api/updates/programs/:needId`,
`PATCH /api/updates/settings`. `updates.changed` carries the status live.

## Security

Who can reach it: the page (signed in), another localhost port or the agent
itself (as any request, through the same guards), and whoever controls the
upstream.

- Checking needs nothing: it changes nothing but `updates.json`.
- Updating installs software or changes the code that runs as you, and
  turning automatic updates on lets Conch install by itself later, so both need
  a password or key from the last ten minutes (the `verifyRequired` "sudo
  mode", NIST SP 800-63B-4 reauthentication; OWASP ASVS 5.0 V8 for sensitive
  operations). Turning it off doesn't. The agent has no tool for any of it.
- Every command is a fixed argument array run without a shell. The only thing
  a request names is a program, which must be a known need; Conch's update
  takes no input at all. Package names and ids are constants, checked against
  a strict pattern before they reach a URL or a command line.
- Git never prompts (above) and runs with Conch's secrets scrubbed from its
  environment (`agentEnv`). Conch only ever moves forward along the branch's
  configured upstream; it never changes remotes, never merges, and never
  resets over local changes.
- Trust in the upstream is the same as running `git pull` by hand: an update
  runs whatever that branch contains. That's the point of updating, and why
  it's a person's press, behind sudo mode, never automatic.

## Consequences

- A new program Conch depends on is a need with `version` + `latest` (+
  `update`), and then shows up in Updates and Repair everything by itself
  (AGENTS.md).
- `UpdatesStatus`, `updates.changed` and the `updates` heal area join the
  protocol. Nacre gains `SoftwareUpdate`, `ProgramUpdates`, and a `dot` on
  `IconButton` and `Tabs.Trigger`.
- The mock engine lists pretend programs (`updates/mock.ts`) and never looks at
  a real checkout unless `CONCH_CHECKOUT` names one; `CONCH_UPDATE_CHECKS=off`
  stops the daily look.

## Known limits

- Between the build and the restart (a few seconds), a page that loads gets
  the new web app from the old gateway.
- On Windows, `pnpm install` may be unable to replace a native module the
  running gateway has loaded (node-pty); that update then goes back to the
  version you had, and says so.
- Homebrew answers from its last `brew update`; winget's `Version:` label is
  read in English, then by position.
- Overnight updates need the computer awake between 2 and 5 a.m.

## Sources

- Git: `git-fetch`, `git-merge --ff-only`, `git-reset --keep`, `git-rev-list
--left-right --count`; `GIT_TERMINAL_PROMPT`, `core.askPass`,
  `credential.interactive` and Git Credential Manager's `GCM_INTERACTIVE`.
- npm registry API (`GET /<package>/latest`); `winget show`; `brew info
--json=v2`; pnpm `install --frozen-lockfile` and `confirmModulesPurge`.
- OWASP ASVS 5.0 V8 (authorization of sensitive operations); NIST SP 800-63B-4
  §2.2 (reauthentication); OWASP Top 10 A08 (software and data integrity):
  fixed sources, fast-forward only, a person's press.
