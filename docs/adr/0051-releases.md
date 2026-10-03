# 0051 — Releases: `pnpm release`, channels, signed tags and the staged swap

- Status: accepted
- Date: 2026-10-02
- Amends: [ADR 0019](./0019-updates.md) (§ Updating Conch itself), [ADR 0026](./0026-always-on.md) (the launcher)

## Context

Every install was a git clone of `main`, and followed `origin/main`. So every
pushed commit was a release. Updates were counted in commits, "What's new" was
commit subjects, and there was no version anyone chose: `SERVER_VERSION` said
`0.2.0` and every package said `0.1.0`. The only sign of an update was a dot in
Settings.

Updating also changed the running copy in place: a merge, `pnpm install` and a
web build under the live gateway, then a restart. A half-finished update was
the copy that was running.

The maintainer wants one simple way to say "this is a release", with short
notes that name what people gain. People using Conch want stable releases by
default, betas if they ask, and an update that can't leave them stranded.

## Decision

### Making a release

`pnpm release` is the whole process for the maintainer: one command, one
question. See [docs/RELEASING.md](../RELEASING.md).

1. **It checks it can.** On `main`, no uncommitted changes, level with
   `origin/main`. Each refusal is one line with the command to run.
2. **It works out the version** from the conventional commits since the last
   stable tag (`release/semver.ts`):
   - a breaking change (`feat!:`, a `BREAKING CHANGE:` footer) is a new major,
     or a new minor before 1.0;
   - a `feat` is a new minor;
   - anything else is a patch.

   `pnpm release beta` and `pnpm release alpha` make `v0.4.0-beta.1`, then
   `-beta.2`. Promoting a beta is just `pnpm release`: the same version, stable.
   `--version x.y.z` overrides it. A version must be newer than every release.

3. **It writes the notes** (below), and shows them with the commits they came
   from.
4. **It asks once:** "Release v0.3.0? (y/N)". `--dry-run` stops before this
   and changes nothing.
5. **Then it does everything.** `pnpm check` (the full check; turbo's cache
   makes it quick when it already passed). The version in the root
   `package.json`. `CHANGELOG.md`, newest first. A `release: v0.3.0` commit.
   An annotated tag, signed with git's own signing. The tag is checked the way
   installs check it. Then an atomic push of the commit and the tag, and a
   GitHub Release with the same notes when `gh` is installed.

   If signing or the check fails, the tag and the commit are taken back and
   nothing is pushed. If the push fails, the release stays ready locally and
   it says the one command that pushes it.

**One version.** The root `package.json` `version` is the only place a version
is written. `SERVER_VERSION` reads it, and so do the installer and the
updater. The workspace packages are private and no longer carry versions.

**Signing.** Releases are SSH-signed annotated tags. If git has no SSH signing
key, `pnpm release` explains in one sentence and offers a key from `~/.ssh`.
It then sets `gpg.format ssh` and `user.signingkey` for this repository only.
A GPG key is refused: installs only check SSH signatures. The first release
adds the maintainer's key to `release/allowed_signers`, which ships empty.

### The notes

At most three groups, **New**, **Better** and **Fixed**, plus a **Heads up**
for a breaking change (`release/notes.ts`). Each is one line per benefit, from
the person's side.

- **Housekeeping is left out.** That means `chore`, `test`, `docs`, `style`,
  `ci`, `build` and `refactor`, plus the `ci`, `e2e`, `docs` and `deps`
  scopes.
- **The commits of one feature become one line.** A feature lands as
  `feat(protocol)`, `feat(server)`, `feat(nacre)` and `feat(web)` in a row. A
  commit joins the feature whose commit shares the most rare words with it,
  within ten commits. A feature's documentation or end-to-end journey ends it.
- **The line comes from the commit closest to the person.** That's the web
  app's commit, then any other. Never the protocol's or a component's. The
  words go through `humanise` (ADR 0019), without ADR numbers, "and its
  tests" or key symbols.
- **A fix to something new in the same release isn't listed.** Nobody saw that
  bug. The feature's line covers it.
- **Bigger features go first**, and each group is capped (8, 5 and 5), with
  "And N more" for the rest. A breaking change's line is its `BREAKING
CHANGE:` footer, which says what to do.

That base is deterministic and needs no model. **A model can polish it**
(`release/polish.ts`). It uses Claude Code (`claude -p`) if it's installed,
else the Anthropic API with `ANTHROPIC_API_KEY`. Only commit subjects are
sent. The answer is JSON, and each line names the groups it came from. It's
set aside, and the base stands, if a line comes from nowhere, if a heads-up
isn't about a breaking change or goes missing, if a group is over its limit,
or if a line has hype words, an exclamation mark, an emoji, a link or code.
The preview says who polished the notes. `--no-ai` skips the polish.

The same notes go into the tag's message (plain words, no `#`, since git would
strip it), into `CHANGELOG.md` and into the GitHub Release.

### Channels

Settings → Health → Updates offers three channels, in plain words:

| Channel | Gets                            | In the app                                                   |
| ------- | ------------------------------- | ------------------------------------------------------------ |
| Stable  | `vX.Y.Z` (the default)          | Tested releases. Recommended.                                |
| Beta    | beta and stable releases        | New things a little early. Mostly finished.                  |
| Alpha   | alpha, beta and stable releases | The newest work, as soon as it's tagged. Expect rough edges. |

Choosing beta or alpha needs sudo mode. Going back to stable doesn't, and
**never downgrades**. A copy on `0.4.0-beta.2` waits for the next stable
release newer than it, and says so: "Conch moves to stable releases with the
next one after it (0.4.0 or later): it never goes back a version by itself."

The installer's `CONCH_CHANNEL` is kept as `git config conch.channel`. It's
the channel until someone chooses one in Settings.

### Where a copy's updates come from

`ReleaseFollower.source` (`updates/releases.ts`) decides between **releases**
and **every change on its branch** (ADR 0019, unchanged):

- the hidden "Every change on main" switch is on (sudo mode; for
  contributors): branch;
- `git config conch.follow branch` is set (the installer sets it for
  `CONCH_BRANCH`): branch;
- a detached HEAD (installed at a tag, or a version folder): releases;
- a branch other than `main`: branch;
- `main` with commits or edits of its own: branch (a developer's copy);
- `main` before the first **stable** release exists: branch. A beta alone
  doesn't move anyone;
- otherwise: releases.

**Moving over.** A clone of `main` keeps updating as before until the first
stable tag exists. Its next look then switches it to the stable channel. Conch
says so once, until it's put away: "Conch now follows its releases instead of
every change: you get each stable release, with a few words on what's new." A
copy already ahead of the newest stable release, by version, is offered
nothing until a newer one comes.

### Finding releases

A look fetches upstream's tags quietly, as before. It never prompts. The
refspec is `+refs/tags/v*:refs/conch/tags/v*`, so tags land in a namespace of
Conch's own. A tag of yours is never replaced, and a tag moved upstream is
simply read again. Tags are read strictly: `v` plus `MAJOR.MINOR.PATCH`,
optionally `-alpha.N` or `-beta.N`, with no leading zeros. Anything else isn't
a release. Order is SemVer's, including pre-releases.

Conch offers the newest release in the channel that's above this version, and
not one that failed here. It lists up to six, each with its notes, newest
first. The notes come from the tag's message, or else from the target's
`CHANGELOG.md` section.

### Checking a release is real

Before anything is shown or installed, the tag is checked (`release/signing.ts`):

1. It must be an annotated **tag object** pointing at a **commit**, and the name
   inside it must be the name it's offered under. A good signature on `v0.2.0`
   can't be passed off as `v0.9.0`.
2. It must be **SSH-signed**. Unsigned and GPG-signed tags are refused.
3. `git verify-tag` checks it with `gpg.format=ssh`,
   `gpg.ssh.allowedSignersFile` set to a temporary copy of the pinned list,
   and `gpg.ssh.program` set to the system's `ssh-keygen`. Whatever git is
   configured with doesn't count.

**The pinned list** is `release/allowed_signers`, read as committed in the
**installed copy** (`git show HEAD:release/allowed_signers`). It's never read
from the release being checked, nor from a file on disk. Trust is carried
forward: a release that changes the list must be signed by a key already on
it. The new key counts from the version that adds it. To rotate, add the new
key in a release signed with the old one.

**Trust on first use.** An install from before the first release has an empty
list. Only then does it take the release's own list, once. It says so with
the "follows its releases" notice.

A refused release is one sentence. Only the newest refused one is reported,
and an older good release is still offered: "Conch 0.3.1 isn't signed, so
Conch won't install it." Notes are only ever shown from a release that checks
out. Updating checks **the same tag object** again, so a tag swapped in
between is refused.

### Updating: ready beside the running version, then a swap

The running folder is never touched (`updates/releases.ts` `stage`):

1. **Verify** the tag object again. Read its `apps/server/package.json` and
   check the native build tools (ADR 0019).
2. **Get it.** `git worktree add --detach CONCH_HOME/versions/<version>
<commit>`, from Conch's own checkout. What a failed try left there is
   cleared first.
3. **Install** and **build** there (`pnpm install --frozen-lockfile`, the web
   build). Progress shows as "Installing · 2 of 4".
4. Check the folder is a Conch, and the version it says.
5. **Back up** your things (ADR 0020, `backupNow`). No backup, no swap.
6. **Swap.** `versions/current` (a pointer file) now names the new folder, and
   `versions/state.json` records a pending swap from the old one.
7. **Restart.** The outage is the restart: a few seconds.

Any failure before the swap removes the new folder and says: "The update
didn't install (…), so Conch kept the version you have. Nothing of yours
changed."

**Everything that starts Conch reads the pointer** (`updates/layout.ts`). That
includes the supervisor, every time it starts the gateway, and the login
launcher on macOS, Linux (`head -n 1`) and Windows (batch `set /p`). A pointer
naming a folder that isn't a Conch is passed over, and the checkout runs. No
symlinks, so Windows needs no special rights. Login items, the menu bar and
the app shortcut point at Conch's checkout (`findRepository`), which never
moves.

**Proving it.** The supervisor watches a pending swap. Once the new gateway is
listening and its own `/api/health` answers, it marks the swap proved.
Otherwise the supervisor goes back by itself. That happens if the gateway
stops first, or stays silent for 90 seconds (then it's stopped). Going back
points at the old folder, marks the version failed (never offered again; a
newer one is), and starts the old version. That version then says so once:
"Conch 0.3.0 didn't start properly, so Conch went back to 0.2.0 by itself."

**Going back by hand** is instant: the version before is still in its folder.
**Go back to 0.3.0** (sudo mode) is a swap and a restart, and the version left
isn't offered again.

**Tidying up.** After a start, version folders nobody needs are removed. Kept
are the folder running, the one before it, Conch's checkout, and the folder
the supervisor itself runs from (`CONCH_SUPERVISOR_ROOT`).

### Data across versions

- **Forward-compatible data.** A new version may add fields and files. An old
  version's Zod parse drops fields it doesn't know when it writes a file back.
  So new data that a rollback must not lose goes in **a new file**, not a new
  field in an old one.
- **One-time migrations** run on the new version's first start, and must be
  additive: write the new shape beside the old, never delete or rename what
  the version before reads. A later release can drop the old shape, once
  going back past it is no longer offered.
- A release with a migration says so in a **Heads up** line.
- **The backup made before the swap** is the safety net. Restore puts it back
  (ADR 0020).

### Installing

`scripts/install.sh` and `install.ps1` install the **newest stable release**
by default. They clone, pick the tag, check its signature against the clone's
own list (with git ≥ 2.34 and `ssh-keygen`), and check it out detached. A tag
signed by anyone else stops the install. `CONCH_CHANNEL=beta|alpha` widens the
pick. With no releases yet they stay on `main`, as before. `CONCH_BRANCH`
(developers) clones that branch and sets `conch.follow branch`.

Running the installer again on a release install doesn't pull. It says
"Conch updates itself: Settings → Health → Updates", and repairs and builds
the folder actually running.

### Where people see it

- **A banner at the top of the app**, once per version: "Conch 0.3 is ready ·
  What's new · Update", with **Not now**. Putting it away is remembered for
  that version.
- **Settings → Health → Updates:** "Conch 0.4 is ready", the notes for every
  waiting release (the newest open), the channel picker, a refused release, a
  notice, and **Go back to 0.3.0** while the version before is kept.
- **The menu bar, tray and panel:** "Conch 0.3 is ready · What's new" opens
  Updates. They never update by themselves.
- **Phones:** a new push topic, `updates` ("New versions of Conch"). It's off
  until you turn it on, and each version is said once.
- **Repair everything:** an `info` item ("Conch 0.3 is ready."), never a
  warning. A refused release is a warning. A broken pointer is repaired.
- **⌘K:** "Update Conch to 0.3", and "Release channel: stable, beta or alpha".

### Routes

`PATCH /api/updates/settings` takes any of `auto`, `channel`, `everyChange`,
`dismiss` (a version) and `dismissNotice` (an id). Sudo mode is needed for
`auto: true`, `everyChange: true` and a channel other than stable.
`POST /api/updates/conch/back` (sudo mode) goes back to the version before.
`POST /api/updates/conch` installs the newest release offered in release mode,
and works as before in branch mode.

## Security

Who can reach it: whoever controls upstream (GitHub, the maintainer's
account), the network between, the page (signed in), the agent itself, and
other users on this computer.

| Who                                      | Could try                                     | What holds                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream compromised (GitHub, a push)    | publish a release with their code             | Installs only take tags signed by a pinned key; the list is read from the installed commit, so a release can't add its own key. Only the maintainer's SSH key signs.   |
| A network attacker                       | change what a fetch brings                    | Same signature check; git objects are content-addressed, so the checked tag object is the commit installed.                                                            |
| Replaying an old release, renaming a tag | offer a well-signed `v0.2.0` as `v0.9.0`      | The name inside the tag object must match; an older version is never offered (no downgrade); a moved tag is just read again and checked.                               |
| Withholding releases (a freeze)          | keep an install on an old version             | Not detected: Conch can't tell "no release" from "releases hidden". Same as any git remote. See Known limits.                                                          |
| The agent itself (prompt injection)      | write a version folder, the pointer, the list | `CONCH_HOME/versions` is a protected path for the agent's file and shell tools; the list is read from git, not disk; switching channels or going back needs sudo mode. |
| Another user on this computer            | change the pointer                            | `versions/` is created 0700 and files 0600 inside `CONCH_HOME` (already the user's own).                                                                               |
| A developer's copy                       | —                                             | Follows its branch with no signature check: the same trust as `git pull`, by choice. "Every change on main" needs sudo mode.                                           |

- Every command is a fixed argument array run without a shell. The only things
  from a request are a channel (an enum) and a version to put away (a short
  string, only compared). A version becomes a folder name only after passing
  the strict release pattern.
- Signature checks use the system's `ssh-keygen` and a temporary
  allowed-signers file. Git's configured signing program is never used to
  verify.
- Updating needs sudo mode and a person's press, as before (ADR 0019). It
  never happens automatically.

## Consequences

- `ConchUpdate` gains `source`, `sourceWhy`, `channel`, `everyChange`,
  `latest`, `releases`, `announce`, `waiting`, `refused`, `failed`,
  `previous`, `notice` and `outcome.releases`. `ConchUpdateStep` gains
  `verify` and `backup`. `DoctorState` gains `info`, `PushTopic` gains
  `updates`, and `TrayInfo` gains `update`.
- Nacre gains `ReleaseNotes`, `UpdateBanner` and `ReleaseChannelPicker`,
  `RepairPanel`'s `info` state, and a `notes` slot on `SoftwareUpdate`.
- `CONCH_HOME/versions/**` is `derived` in backups (installed again from
  releases).
- A release is a maintainer's act: `pnpm release`, in
  [docs/RELEASING.md](../RELEASING.md).
- No new dependencies.

## Known limits

- **First use.** An install from before the first release, and a fresh install
  (its list comes from the same clone), trust whatever key the first release
  names. Their trust is HTTPS to GitHub, as before. Everything after is pinned.
- **Freeze attacks** (withholding new releases) aren't detected. There's no
  signed timestamp or snapshot, as TUF has.
- Checking needs `ssh-keygen` (with macOS, Linux and Git for Windows) and git
  2.34 or newer. Without them, a release is refused in a sentence.
- `install.ps1` hasn't been run on Windows here. Its tag pattern is tested from
  JavaScript.
- Each kept version has its own `node_modules`. pnpm's store hard-links most
  files, but disk use grows with each version kept (at most the current one,
  the one before, and the checkout).
- Conch's checkout itself stays at the commit it was installed at. Versions
  are made from it, and it's kept as the last fallback.

## Sources

- Git: `git verify-tag`, `gpg.format`, `gpg.ssh.allowedSignersFile`,
  `gpg.ssh.program`, `git worktree add --detach`, refspecs with `+` (forced
  updates).
- OpenSSH `ssh-keygen(1)`: `-Y verify`, `-Y find-principals`, and the ALLOWED
  SIGNERS format (`namespaces="git"`).
- The Update Framework (TUF) and Sigstore on rollback, freeze and
  mix-and-match attacks. We take their rollback and name-binding protections,
  and name freeze as a limit.
- OWASP Top 10 A08:2021 (software and data integrity failures); NIST SP
  800-218 (SSDF) PS.2 (release integrity) and PS.3 (archiving releases).
- Conventional Commits 1.0.0; Semantic Versioning 2.0.0 §9–11 (pre-release
  ordering).
