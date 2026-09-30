# 0015 — The terminal

- Status: accepted
- Date: 2026-09-30

## Context

People who use Conch on the machine it runs on keep reaching for a terminal to
check a file, restart something, or run what the assistant suggested. People on a
phone or a laptop elsewhere have no terminal at all. Every coding agent's desktop app
(VS Code, Cursor, Zed, Warp) puts one a keystroke away. Web shells (ttyd, Gotty,
Wetty, code-server) show the risk: a terminal in a browser tab is a remote shell as
you. Their public incidents are the usual ones:

- open to the network with no auth (Gotty's default);
- cross-site WebSocket hijacking where the socket didn't check `Origin`;
- sessions that outlive a revoked sign-in;
- secrets leaking into the child environment.

Conch already runs commands as you through the agent, behind permission prompts. A
terminal is the same power without the prompts, so it must be at least as locked down
as everything else, and on every other device it must be stricter.

## Decision

A **terminal panel**, one keystroke (<kbd>Ctrl</kbd> + <kbd>\`</kbd>) away on every
screen. Real shells on the host run through a pseudo-terminal, rendered with xterm.js
in Conch's own colours. Terminals keep running while the panel is closed and come
back exactly where they were.

### How it feels

- **A drawer, not a page.** It surfaces from the bottom of whatever you're doing,
  resizable, with tabs for several shells. It opens in the working folder. The shell
  is yours (PowerShell 7 or Windows PowerShell, or your login `$SHELL`), and
  Settings › Terminal lets you pick another.
- **It keeps going.** Closing the panel, reloading the page or switching devices
  doesn't end anything. On return you get the same shell, its scrollback, and
  whatever is still running.
- **In Conch's colours.** The ANSI palette, cursor and selection come from Nacre
  tokens (light and dark), in Geist Mono. It uses the GPU renderer where it can, and
  falls back to the DOM renderer, invisibly, where it can't.
- **It works with the assistant, never behind your back.**
  - Select output and **Ask** puts it in the composer with your question.
  - Shell code blocks in replies get **Run in terminal**: it types the command and
    waits for your Enter, so it never runs anything itself.
  - The agent has no access to your terminals: no tool, no output, nothing.
- **It fits the hand.**
  - Links open.
  - Search is there.
  - Tabs show when a background shell has new output.
  - A shell that exits says so, with Restart.
  - On touch screens a key row adds Esc, Tab, Ctrl and arrows.
  - <kbd>Shift</kbd> + <kbd>Esc</kbd> leaves the terminal for the keyboard, like the
    browser panel.

### Security

**Who can open one.**

- **This computer** (a genuinely local request: loopback socket, loopback `Host`, no
  proxy headers): yes, like the rest of Conch.
- **Any other device: off by default.** Settings › Terminal › _From other devices_
  turns it on, and turning it on needs a recent password or key. The checkup warns
  while it's on.
- **Every time** another device opens or re-attaches a terminal, it needs a password
  or key from the last 10 minutes (sudo mode, ADR 0008). A stolen cookie alone
  doesn't give a shell.
- **The agent never.** There is no terminal tool, and its browser can't reach the
  gateway (ADR 0014).

**The socket.**

- `/api/terminal/live` is under `/api`, so the gateway's checks apply:
  - the `Host` allowlist;
  - Fetch Metadata;
  - `Origin` must equal the host and port (which stops cross-site WebSocket
    hijacking);
  - sign-in.
- Every message is re-checked against the sign-in, and validated with Zod.
- Input is capped at 64 KB per message and resizes are clamped.

**Sign-out ends shells.** When a device is signed out (or its key revoked), its
sockets close and the terminals it opened are ended. Terminals opened on this
computer aren't touched.

**Clean environment.**

- The shell gets your environment minus Conch's own `CONCH_*` configuration and any
  parent agent's session variables (`agentEnv`).
- It also gets `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=conch`.

**Nothing recorded.**

- Input and output are never logged.
- Scrollback lives only in the gateway's memory, capped at 2 MB per terminal, and
  is gone when the terminal ends.

**Limits.**

- At most 12 terminals.
- A terminal nobody has watched and that printed nothing for 24 hours is ended.
- Flow control pauses a shell whose viewer can't keep up (`cat` of a huge file never
  floods memory).

### Self-healing (working agreement 11)

- **The PTY.**
  - `node-pty` ships prebuilt binaries for Windows and macOS. On Linux it compiles
    at install.
  - If it can't load, Conch falls back without asking: to a small Python PTY bridge
    on POSIX (`python3` is almost always there), else to a basic pipe-backed shell.
    Either way, it notes that it did.
- **The shell.** If the shell you picked is gone, it uses the next one found, and
  says so. A working folder that no longer exists becomes your home folder.
- **A shell that dies at start** (a broken profile) is offered **Start without your
  profile** (`-NoProfile`, `--noprofile --norc`, `-f`), instead of a dead end.
- **Conch restarted.** Terminals end with the gateway. The panel notices on
  reconnect and opens a fresh one in the same folder, with a quiet note, instead of
  an error.
- **The connection.** It reconnects with backoff, and the screen is restored from
  scrollback. No output is lost while the shell keeps running.

## Consequences

- New runtime dependencies. All are MIT, published December 2025, and used by VS
  Code:
  - gateway: `node-pty` (native, with prebuilds; allowed to build in
    pnpm-workspace);
  - web: `@xterm/xterm` and its `fit`, `web-links`, `search`, `unicode11` and
    `webgl` addons.
- New data: `~/.conch/terminal.json` (settings). Terminals themselves are never
  written to disk.
- New protocol: `/api/terminal` REST, the `/api/terminal/live` socket, and a
  `terminal.changed` broadcast. `PROTOCOL_VERSION` 6.
- **Residual risk.** On a machine where other people have accounts, anyone who can
  reach Conch locally with sign-in off can open a terminal as you. The checkup says
  so and suggests a password, as before.
