# 0026 — Just open it: the installer, Always on, and Conch as an app

- Status: accepted
- Date: 2026-10-01
- Builds on: [ADR 0019](./0019-updates.md) (Conch updating its own checkout),
  [ADR 0006](./0006-routines.md) (routines; "launch at login" was future work there),
  [ADR 0018](./0018-channels.md) (chat apps reach Conch only while it runs)

## Context

The Conch promise is that anyone can use it, including people who have never
opened a terminal. Three things broke it before the first message:

1. **Getting Conch** took `corepack enable`, `pnpm install` and `pnpm start`,
   and Node 24 had to be there already.
2. **Keeping it running** meant leaving a Terminal window open. Closing it
   stopped Conch, along with every routine, every chat app and every phone
   that reached it. ADR 0006 left "launch at login" for later.
3. **Opening it again** meant knowing an address, or finding the folder and
   running `pnpm start`.

The two agents people compare Conch with handle this as follows:

- **OpenClaw** has a `curl | bash` installer and `openclaw onboard
--install-daemon` (launchd and systemd). It calls itself "terminal-first by
  design", and a maintainer said "if you can't understand how to run a
  command line, this is far too dangerous".
- **Hermes** has a `curl | bash` installer, a gateway "background process",
  and a desktop app, and its users ask for a lighter client.

Both expect a terminal for their service commands, and neither turns a running
window into a background service without losing your place.

## Decision

### One line to install

`scripts/install.sh` (macOS, Linux) and `scripts/install.ps1` (Windows) do,
in order:

1. **Node.js 24.** It uses one that's already there: on `PATH`, Homebrew,
   Volta, nvm, fnm. Otherwise it downloads the newest 24.x from nodejs.org into
   `~/.conch/runtime`. The tarball must match `SHASUMS256.txt` from the same
   origin, over TLS 1.2+ with `--proto =https`. That is the integrity check nvm
   and the Node Docker images use. No administrator, nothing system-wide.
2. **Git**, because updates move a git checkout (ADR 0019).
   - **macOS:** Homebrew when it's there. Otherwise Apple's Command Line Tools
     prompt ("press Install, and Conch carries on"), and the installer waits
     for it.
   - **Linux:** it names the package manager's command and asks before using
     `sudo`.
   - **Windows:** MinGit from Git for Windows' latest release, checked against
     the asset's SHA-256 digest from GitHub, into Conch's own folder.
3. **Conch's folder:**
   - macOS: `~/Library/Application Support/Conch/app`
   - Linux: `$XDG_DATA_HOME/conch/app`
   - Windows: `%LOCALAPPDATA%\Conch\app`

   This is not `~/.conch`, which is the person's data and is backed up
   (ADR 0020).

4. **Terminal prerequisites** (macOS/Linux), before dependency installation.
   `scripts/install-prerequisites.sh` detects Python 3, make and C/C++ compilers.
   Linux offers fixed commands for apt, dnf, pacman, zypper or apk; Debian/Ubuntu
   refresh the package index and install `build-essential python3`. macOS offers
   Apple's Command Line Tools and, when needed and available, Homebrew Python.
   Each system change is shown and approved through the controlling terminal.
   Sudo authenticates there once; package commands use `sudo -n`, never a stored
   password. Conch, pnpm, lifecycle scripts and the build remain unprivileged.
   Declined permission, missing sudo, no keyboard, failed package installation,
   unsupported managers and `--no-system-packages` all continue to the fallback.
   No repository configuration is changed and no system upgrade is performed.
5. `pnpm install --frozen-lockfile` and the web build, through Node's own
   corepack (pnpm pinned by `packageManager`). Each step is quiet unless it
   fails, and then it shows the last lines. `node-pty` is optional (including in
   the generated lockfile): a failed native build is not a failed install. The
   installer probes the actual installed backend and reports native, Python or
   basic mode instead of promising that the terminal compiled.
6. **Conch as an app** (`pnpm conch shortcut`), **Always on**
   (`pnpm conch background on`), and the browser opens.

It refuses to run as root. Running it again updates Conch (a fast-forward
only, never over local changes) and repairs what moved. `--uninstall` stops
Conch, takes it off the login items and out of the apps, and removes its
folder. It keeps `~/.conch` unless `--delete-data` is given and the person
types `delete`.

### Missing tools during updates

The updater never installs system packages or prompts for administrator access.
Before moving the checkout it reads the target server manifest with `git show`,
without running target code. Optional native dependencies do not block updates.
A Linux target that makes `node-pty` mandatory requires Python 3, make and C/C++
compilers first; otherwise the current checkout and dependencies remain untouched.
An unreadable target manifest also stops before mutation. Dependency/build
failures still use the existing rollback (ADR 0019).

This follows [node-gyp's prerequisites](https://github.com/nodejs/node-gyp#installation),
[node-pty's platform dependencies](https://github.com/microsoft/node-pty#dependencies),
and [pnpm's optional dependency contract](https://pnpm.io/package_json#optionaldependencies).
The installer tests use an isolated PATH with fake package managers: consent,
no TTY, unavailable sudo, failed authentication, install failure, post-install
rechecks and repeated runs. Runtime tests force a missing native module and
exercise the real Python PTY's input, output and exit status.

### Always on

Every computer has its own way to start a program at login without an
administrator, and Conch uses that one:

| Computer        | Mechanism                                                                                                                              | Shown in                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| macOS           | LaunchAgent `~/Library/LaunchAgents/app.conch.gateway.plist`: `RunAtLoad`, `KeepAlive.SuccessfulExit=false`, `ProcessType=Interactive` | System Settings → General → Login Items |
| Linux (systemd) | User unit `~/.config/systemd/user/conch.service`, `Restart=on-failure`, `RestartPreventExitStatus=78`                                  | —                                       |
| Linux (other)   | `~/.config/autostart/conch.desktop`                                                                                                    | the desktop's startup apps              |
| Windows         | `HKCU\…\Run` value `Conch`, running `wscript` on a `.vbs` that starts a batch file with no window                                      | Task Manager → Startup apps             |

All of them run the same **launcher**, `~/.conch/background/Conch` (or
`conch.cmd` on Windows). Conch writes it, and rewrites it when something
moves.

- **It looks for Node each time it starts.** It tries the one Conch ran with,
  then `PATH`, Conch's runtime, Homebrew, Volta, nvm, fnm, mise and asdf, and
  takes the first that is 24 or newer. Homebrew and nvm move Node on every
  upgrade, so a login item that remembered one path would stop working and
  never start again to heal.
- **It carries a small allowlist of environment** into the login:
  - the host, port and remote-access settings;
  - proxies and CA certificates, which often live only in a shell profile;
  - the `PATH` Conch was started with, where the providers' programs are.

  A proxy URL with a password in it is left out. API keys and tokens never go
  in (the test proves it).

- **It keeps its log small.** The log is `~/.conch/logs/conch.log`, the
  gateway logs at `warn` by default, and the launcher rotates the file past
  5 MB.
- **When it can't run, it exits 78 (`EX_CONFIG`).** It says why in a
  sentence, and systemd doesn't loop on it.
- **It runs Conch's own supervisor** (`start.ts`, `CONCH_SUPERVISE=1`) with
  `CONCH_BACKGROUND=1`, so restarts after an update or a restore work as they
  do with `pnpm start`. A clean exit (Quit) stays stopped. A crash is started
  again: by the supervisor first, then by the computer.

Each `CONCH_HOME` gets its own label (`app.conch.gateway.<8 hex>` for any but
the default), so a test or a second Conch never takes over the real one.

### The handover

Turning Always on on from a Conch running in a Terminal window doesn't ask
the person to close anything:

1. Conch registers the launcher and starts it now (`launchctl bootstrap` or
   `kickstart`, `systemctl --user start`, or `wscript`).
2. The background Conch finds a Conch in a window at its address. It writes
   `background/waiting.json` (its pid), loads everything, and waits for the
   place to be free (`waitForTurn`).
3. The window Conch sees a live pid there, answers `{ handover: true }`, and
   stops a moment later. It says in the Terminal: "Conch now runs in the
   background, so you can close this window."
4. The page rests on the calm restart screen ("Moving Conch to the
   background…"). The background Conch, already loaded, takes the port, and
   the page reloads onto it by its boot id, back in Settings → Health.

If no Conch is seen waiting within a minute (no Node, the folder moved),
nothing stops. The window Conch keeps running, and Always on shows the
launcher's last words and the command to read the whole log. If someone
closes the window while a background Conch waits, that one simply takes over.

**Turning it off never stops the Conch you're using.** It unregisters, and a
background Conch keeps running until you quit it or log out ("Running until
you quit it"). Only a background Conch that is waiting for its turn is
stopped (`bootout`, `systemctl stop`, or its pid).

**Quit** is its own button, and `pnpm conch quit` does the same. It needs a
recent password or key, like a restart, and waits while a chat is working.
The gateway exits 0, so launchd and systemd leave it stopped. The page rests
on "Conch has stopped" with a pearl that doesn't breathe, and comes back by
itself when Conch is opened again.

### Conch as an app

`pnpm conch shortcut` (and **Add Conch to Applications** in Always on) puts
"Conch" where people look for apps:

- **macOS:** `~/Applications/Conch.app`, found by Spotlight and Launchpad. It
  is a real bundle with `LSUIElement` set (no Dock bounce) and an `.icns`
  made by the Mac's own `sips` and `iconutil` from Conch's icon.
- **Windows:** a Start menu shortcut, made with `WScript.Shell`.
- **Linux:** an XDG desktop entry.

Opening the app opens Conch in the browser. If Conch isn't answering, the app
starts it — through Always on's agent when that's on, or once by itself — and
says "Starting Conch…" the computer's own way (a notification, or
`notify-send`). It opens Conch the moment `/api/health` answers, or after a
minute says what to do.

These are files Conch writes on the person's computer, not downloads.
Gatekeeper and SmartScreen check what arrives from the internet, and nothing
arrives. Signing and notarising would be needed for a downloaded `.app` or
`.exe`; that is deliberately not this design.

The app icon (`apps/web/public/icons/conch.svg`, rendered to PNGs) is the
Lustre pearl on a porcelain tile.

### Everything else Conch covers

- **Repair everything.** The `background` check:
  - **ok** when on;
  - **fixed** when a repair rewrote the launcher or the app (Node or the
    folder moved);
  - **needs-you** when the computer turned it off: Login Items or Startup
    apps (`launchctl print-disabled`, `StartupApproved\Run` byte `03`),
    with the command that opens the right settings;
  - **warning** when routines or chat apps are on but only run while a window
    is open;
  - **off** otherwise.

  The same healing runs on every start.

- **In context.** Beside a routine that's on, and a chat app that's connected,
  `AlwaysOnHint` says "…only while Conch is running, and closing its Terminal
  window stops it", with **Keep Conch running**: one press, the same handover.
  It's shown only when Conch runs in a window and Always on can be turned on.
- **⌘K.** "Always on" (start at login, background, login items) and "Quit
  Conch" both open Settings → Health → Always on.
- **Backups.** `background/**`, `logs/**` and `shortcut/**` are derived: they
  are about this computer's paths. A restore never turns Always on on; it is
  switched on by a person, on that computer.
- **The mock engine.** It has a pretend backend and puts its app in its own
  home, so tests and `pnpm dev:mock` never add anything to the computer's
  login items.

## Security

The question is who can turn it on.

- `PUT /api/background` and `POST /api/gateway/quit` sit behind the gateway's
  host, origin and sign-in checks, and need **sudo mode** (a password or key
  from the last ten minutes) on any device that signed in. Turning it on
  "enables automation", in AGENTS.md's words: Conch runs with nobody
  watching. The agent can't call these routes, because its tools don't carry a
  session (agreement 7).
- Everything Conch writes is the person's own:
  - the launcher is `0700` in a `0700` folder;
  - the LaunchAgent is `0644`, because launchd refuses agents others can
    write.

  None of these runtime files needs `sudo`. The installer refuses to run as root;
  only explicitly approved system-package commands may use sudo, so no
  root-owned Conch file ends up in a home folder.

- **No secrets in the launcher.** The environment it carries is an allowlist,
  and proxies with credentials are dropped.
- **Every path is quoted for its own language,** and tested with the awkward
  paths people have (spaces, quotes, `$`, `%`, backticks, non-ASCII):
  - sh single quotes;
  - plist XML escaping;
  - systemd quoting, with `$$` and `%%`;
  - freedesktop `Exec` rules;
  - batch `%%`;
  - doubled VBScript quotes.
- **Downloads are checked:** Node against nodejs.org's SHA-256 list, MinGit
  against GitHub's asset digest, both over HTTPS only. GPG verification of
  `SHASUMS256.txt` would add a key the person can't judge, so Conch relies on
  TLS to the origin, as nvm, fnm and the official Docker images do.
- **The launcher is a login item, so tampering with it is persistence.** Conch
  rewrites the launcher and the computer's file on every start and from Repair
  everything (`heal`), so a changed launcher is put back the next time Conch
  starts. An agent with a shell can add a login item of its own anyway, so this
  is treated as hygiene, not a boundary; the boundary stays the permission
  prompts (ADR 0008).
- **Exposure is unchanged.** The background Conch listens where the window one
  did, and the security checkup still warns about a network address.

## Consequences

- Most people never see a terminal after the one line, and the installer is
  the only one they see. Conch is in their apps, starts at login, and moves
  itself to the background with one switch.
- What's tested:
  - the launcher, run for real against a pretend Node: found, too old, missing;
    the folder moved; log rotation;
  - each backend, against pretend `launchctl`, `systemctl` and `reg`;
  - the handover with a real second process;
  - the Mac app bundle, with `plutil` and a real `.icns`;
  - opening the app, against a real local server: when it is up, and when the
    app has to start it;
  - an e2e journey.

  The installer was run end to end on macOS in a fresh home folder: Node
  downloaded and verified, a real LaunchAgent, the handover, quit, reopening
  from the app, and uninstall.

- **Not yet verified on a real Windows or Linux desktop:** `install.ps1`, the
  Run key and the Start menu shortcut, and systemd and autostart. Their files
  and commands are unit-tested.
- If a window Conch hopped to another port because its usual one was busy,
  the background Conch may start on the usual one after a handover. The page
  then shows the "taking longer than usual" line rather than reloading.
