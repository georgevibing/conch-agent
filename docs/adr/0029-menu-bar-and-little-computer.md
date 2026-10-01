# 0029 — In the menu bar, and a little computer

- Status: accepted
- Date: 2026-10-01
- Builds on: [ADR 0026](./0026-always-on.md) (Always on, the installer, Conch as an app),
  [ADR 0027](./0027-in-your-pocket.md) (the phone's secure address over Tailscale),
  [ADR 0008](./0008-access-and-hardening.md) (loopback, sudo mode)

## Context

Always on (ADR 0026) left Conch running with no window, so there was nothing to
see. People couldn't tell whether it was running. Quitting meant opening a page,
and starting it again meant finding an app. Every assistant people compare
Conch with gives itself a presence: OpenClaw's macOS app sits in the menu bar,
and Hermes users ask for one.

The people who keep an assistant running all day also want a dedicated
computer for it: a Mac mini in a cupboard, a Raspberry Pi, a Linux box nobody
logs in to. Three things got in the way:

- a Linux user's services stop at logout;
- a Mac sleeps when idle;
- the installer always opened a browser and never said how a phone reaches the
  computer.

## Decision

### 1. Conch in the menu bar, the tray or the panel

Each computer runs a small helper that Conch writes and builds there:

| Computer | The helper                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | A Swift `NSStatusItem` with a template pearl that suits light and dark menu bars. Built by `xcrun swiftc` into `~/.conch/tray/Conch Menu.app` (`LSUIElement`: no Dock icon). |
| Windows  | PowerShell with Windows Forms' `NotifyIcon`, using the pearl as an `.ico`.                                                                                                   |
| Linux    | Python with AppIndicator (Ayatana or the older one), using the pearl as a PNG.                                                                                               |

On Windows and Linux its picture is the pearl alone (`icons/conch-tray.svg`,
rendered to `conch-tray-256.png`): as big as its square allows, on a
transparent ground, the way a tray's icons are drawn. The app icon's tile
would only make the pearl small. A new picture replaces a running helper,
as new source does.

There is no Electron, nothing is downloaded, and no app store is involved.
What it needs is a Conch need (`setup/known.ts`):

- `command-line-tools` (`xcode-select --install`);
- `appindicator` (`python3-gi` and the indicator's GIR).

**What it shows.**

- Whether Conch is running, and whether it's Always on.
- A dot when a question or a new device is waiting.
- Open Conch, Start Conch, Quit Conch, and Always on….
- Hide from the menu bar.

**When it runs.** It's on by default (`preferences.menuBar`). The gateway
shows it whenever it starts, at login with Always on, and every five minutes
starts it again if it has stopped. It is rebuilt when its source changes and
replaced when Conch updates. It outlives Quit, so "Start Conch" stays one click
away. Start runs `tray/start`, which uses the computer's own login item when
there is one (`launchctl kickstart`, `systemctl --user start`) and the
launcher otherwise. Everywhere else, Repair everything's `tray` check starts
it again. **Settings → Health → Always on** and `pnpm conch tray on|off`
switch it. Hiding it from the helper itself sets the preference, so it stays
hidden. Uninstalling removes `~/.conch/tray`.

**How it's started on Windows.** A detached program has no console, and
`powershell.exe` without one leaves at once (exit 0, nothing run); one that
isn't detached goes when the gateway does. So a short-lived PowerShell starts
the helper with `Start-Process -WindowStyle Hidden` and says its pid: the
helper gets a hidden console of its own and outlives Quit. A helper that has
gone a moment after starting counts as not started, so Repair everything
never says "back in the tray" for one that isn't there.

**It only shows where it can.** Over SSH a Mac has no menu bar
(`launchctl managername` isn't `Aqua`), and a Linux box with no `DISPLAY` or
`WAYLAND_DISPLAY` has no panel. There, Conch says so, offers no switch, and
doesn't try.

**Security.** The helper is a client like any other, with less power than any
other:

- It talks only to `http://localhost:<port>`, and only to
  `GET /api/tray/status`, `POST /api/tray/quit` and `POST /api/tray/hide`.
- It carries a 256-bit token from `tray/token` (0600) in `X-Conch-Tray`. The
  gate compares it in constant time and accepts it only from loopback, never
  through a proxy (`Gatekeeper.trayAllowed`, `TRAY_API`).
- The token opens nothing else; it isn't a sign-in.
- Status returns counts only: the assistant's name, Always on, and how many
  questions and devices are waiting. Nothing from a chat.
- Quit is what Ctrl+C would do from the same computer, and it's refused while
  a chat is working.
- Anything that needs sudo mode opens the page: turning Always on on or off,
  approving a device, answering a question. The helper never holds more than
  a person sitting at that computer.
- The token is derived: it isn't backed up (`tray/**`).

### 2. A little computer

All under **Settings → Health → Always on**, each only where it means
something on this computer.

- **Keep running after you log out** (Linux). This is systemd lingering
  (`loginctl enable-linger <you>`). Most systems let you set it for yourself.
  Where they don't, Conch shows the one `sudo` command with a Copy button.
  Turning it on lets Conch act with nobody there, so it needs sudo mode;
  turning it off never does. On a Mac and on Windows, Conch says how to stay
  logged in instead: automatic login, and lock the screen rather than log out.
  `pnpm conch background after-logout on|off` does the same from a terminal.
- **Keep this Mac awake** (opt-in, `preferences.keepAwake`). The background
  Conch holds `caffeinate -s -w <its pid>`: on mains power, the Mac doesn't
  sleep while Conch runs, and the hold ends with Conch whatever happens. It
  never applies to a window or dev Conch.
- **`install.sh --server`** (`CONCH_SERVER=1` for `install.ps1`). The
  installer:
  - doesn't open a browser or add an app shortcut;
  - turns on Always on and lingering;
  - asks for a password on the terminal if there's none;
  - turns on the phone's secure address (`pnpm conch phone`: `tailscale serve`,
    ADR 0027);
  - prints the address and a pairing QR code (`pnpm conch pair`).

  It doesn't open anything to the internet. Without Tailscale, it says how to
  get it and the two commands to run after.

## Consequences

- Conch is visible on every desktop and quits and starts without a page, and
  no new client can do more than the person at the computer.
- A spare computer becomes a Conch box with one line, and the phone is signed
  in from the terminal it was installed in.
- **Known limits:**
  - The Mac helper needs Apple's Command Line Tools to build. That's a large
    download, offered with **Get it** rather than taken silently.
  - A Linux desktop without an AppIndicator host (plain GNOME without the
    extension) shows nothing, even when the libraries are there.
  - The menu bar itself was checked on macOS only. The Windows and Linux
    helpers are verified as source (quoting, endpoints, the token), not on a
    screen.
  - A Mac can't keep running with nobody logged in. Conch says how to stay
    logged in, rather than installing a LaunchDaemon as root.
