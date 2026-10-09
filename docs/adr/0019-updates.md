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
  look give or take an hour of jitter, and on **Check now**. Conch's own
  version is looked at far more often, alone, since it's one quick question
  (amended Oct 2026): every 15 minutes for a copy following its branch, every
  hour for releases (a fifth of jitter either way), and when a page comes back
  into view (`POST /api/updates/look`, single-flight, skipped if the last look
  is under five minutes old; a page asks at most once a minute). What it finds
  reaches open pages live (`updates.changed`). Nothing waits on
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
   or no pnpm. While a chat is working it asks first (amended below).
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
No toasts.

**Amended (Oct 2026): Conch's own update, from anywhere.** When Conch itself
can update, a small `UpdateChip` sits beside your name at the foot of the
sidebar. It never updates by itself: it opens `UpdateDialog`, the one modal
here, which says what the update brings (a release's notes, or every change
in plain words on a branch, up to 40 lines, `from → to` commits) and has the
one press. The same dialog carries the update forward (`PearlProgress`: the
pearl fills a ring of nacre; a reading light moves down what's coming;
ripples while Conch starts again; a bloom and "You're on the new Conch" when
the page is back). It never flashes back, can be closed at any point, and is
the calm screen during the restart while it's open (`RestartWatch` stands
aside). The banner, ⌘K and Settings' **Update Conch** open it too. The build
step's progress is told from how long the last build took here
(`buildProgress`, never past 97%), so step 3 no longer sits still.

**Amended (Oct 2026): updating while something works.** Step 1's wait made
**Update now** refuse with `busy` while a chat, a task or a routine ran; the
dialog showed the sentence once, and every later press showed the same one,
so it read as a button that did nothing. Now a press always answers:

- `POST /api/updates/conch` takes `when` (`UpdateConchBody`). `now`, the
  default, still answers `busy`, and `UpdatesStatus.working` names what's
  running, so the dialog asks in place (`UpdateDialog` `confirm`, never a
  second modal): "Fix Conch CI failures is working. Update anyway? It will
  pause, and carry on after Conch restarts." with **Wait until it's done** and
  **Update anyway**.
- `idle` arms the update (`ConchUpdate.armed`, kept in `updates.json`, so a
  restart keeps waiting): one timer, only while armed, looks whether anything
  still works and updates once nothing does. The dialog and Health say "Will
  update when the chat finishes"; **Don't wait** (`cancel`, no password: it
  takes nothing away) stops it.
- `anyway` updates while the work goes on, and only just before the restart
  pauses it: `Services.pauseWork` (also every requested restart, through
  `main.ts`'s restart handler, and `POST /api/gateway/restart` with
  `when: 'anyway'`). `ConversationManager.pause` holds every new step at the
  guard, unrun, gives steps already running up to 15 seconds to finish, and
  marks each working chat `pausedFor`; tasks and routine runs are marked too.
  A step waiting for an approval is a safe point: it never ran. If the restart
  doesn't happen, `unpause` lets everything go on.
- After the restart, recovery knows it was planned: the steps held at the
  pause and the approvals never answered are "not run", so they're asked again
  rather than counted as uncertain; a planned pause never spends the crash
  budget; the turn carries on with a note that says so, and the chat says
  "Conch updated and picked up where it left off" (`restarted.reason`). A task
  carries on from its ledger (`retry`), a routine run in its own chat, each
  closing the cut-off turn first (`settleInterrupted`). A step that may have
  finished is still never repeated by itself: the chat says why and offers
  **Carry on**, as does a provider that couldn't load its session (a notice,
  and the chat so far handed over, ADR 0069). Queued messages stay with the
  tab (`sessionStorage`) through the reload.

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

## The web app's stamp

Code pulled by hand (`git pull` in the checkout) and a restart gave the
gateway new code but left the old web app: nothing had rebuilt `apps/web/dist`,
and Update said Conch was current. Every web build now writes
`dist/build.json` (`{ commit, builtAt }`, from a Vite plugin; no commit
without git). A gateway that serves its own checkout's build under
`pnpm start` (never a dev server, a release folder or the desktop app)
compares it with `HEAD` when it starts: a stamp naming another commit, or
none beside a built app, rebuilds it in the background, with a note under
Fixed on its own (`updates/webbuild.ts`). That build goes beside the app
serving (`apps/web/dist.next`, `vite build --outDir dist.next --emptyOutDir`
through the same pnpm command), then two renames swap it in (`dist` →
`dist.old`, `dist.next` → `dist`), so a page never sees half an app. The
gateway serves `/assets/*` it doesn't have from `dist.old`, so an open page
still loads its lazy parts; the next start clears both folders. Update's own
build still writes `dist` in place, since a restart and a reload follow it. Pages
compare their own `builtAt` with `UpdatesStatus.webBuilt` and offer to
reload. Update with nothing new installs and builds instead of saying
current, and Repair everything offers the same rebuild.

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
