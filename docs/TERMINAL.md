# The terminal

Conch has a terminal built in: a real shell on the computer Conch runs on, one
keystroke away from whatever you're doing. Check a file, restart something, or run
the command the assistant just suggested, without leaving the chat.

## Opening it

Press <kbd>Ctrl</kbd> + <kbd>\`</kbd> (<kbd>⌘</kbd> + <kbd>\`</kbd> on a Mac), or
click the terminal button at the top right. The terminal slides up from the bottom
with a shell ready, in your working folder. Press the same keys again to put it
away.

- **Another terminal:** the **+** in its tab bar, or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> +
  <kbd>Shift</kbd> + <kbd>\`</kbd>. The arrow beside the **+** opens one with a
  different shell (PowerShell, Command Prompt, Git Bash, zsh, bash, fish…).
- **Bigger or smaller:** drag the top edge, or press the expand button to fill
  the screen.
- **Leave it for the chat:** <kbd>Shift</kbd> + <kbd>Esc</kbd> moves the keyboard
  back to the message box.
- **Close a terminal:** the × on its tab, or **Close this terminal**. Closing it
  ends the shell. Hiding the panel doesn't.
- You can also find **Show the terminal** and **New terminal** in
  <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd>.

## It keeps going

Hiding the panel, reloading the page, or putting your laptop to sleep doesn't stop
anything. When you come back, you get the same shell, with what it printed and
whatever is still running. A tab shows a small pearl when a shell you're not looking
at prints something.

When a shell ends, the terminal says so and offers **Restart**. If Conch itself
restarted, your terminals ended with it, so the panel quietly opens a fresh one in
the same folder.

## Working with the assistant

- **Ask about output.** Select something in the terminal (an error, a log) and press
  **Ask Conch**. It goes into the message box, ready for your question.
- **Run in terminal.** Commands in the assistant's replies have a **Run in
  terminal** button. It types the command into your terminal and waits. Nothing runs
  until you press <kbd>Enter</kbd>.
- The assistant can't see or use your terminals. What you do there stays between you
  and your computer.

## Copy, paste, find

- **Copy:** select, then <kbd>Ctrl</kbd> + <kbd>C</kbd> (<kbd>⌘</kbd> + <kbd>C</kbd>).
  With nothing selected, <kbd>Ctrl</kbd> + <kbd>C</kbd> stops the running command,
  as usual.
- **Paste:** <kbd>Ctrl</kbd> + <kbd>V</kbd> (<kbd>⌘</kbd> + <kbd>V</kbd>).
- **Find:** the magnifying glass in the tab bar.
- **Links** in the output open in a new tab.
- **On a phone or tablet,** a row of keys adds Esc, Tab, Ctrl and the arrows.

## Settings

Settings → Terminal:

- **Let me open terminals in Conch.** Turn it off, and the button, the shortcut and
  every open terminal go away. Pressing the shortcut again explains why, with a
  **Turn it on** button.
- **Text size.**

Under **Advanced**: the **Shell** (your usual one, or another installed shell), a
**Blinking cursor**, **Screen reader support**, which makes what the terminal prints
readable to screen readers, and **From other devices** below.

## Staying safe

A terminal can run anything as you, so Conch is careful with it:

- **Only on this computer, unless you say otherwise.** On your phone or another
  computer, terminals are off. To use one there, turn on **From other devices** in
  Settings → Terminal → Advanced. That asks for your password first, and the security checkup
  reminds you while it's on.
- **Even then, it checks it's you.** Every time another device opens a terminal, or
  reconnects to one, it asks for your password or key if you haven't entered it in
  the last 10 minutes. A stolen sign-in alone isn't enough.
- **Signing a device out ends its terminals.** So does revoking a key, or turning
  **From other devices** off.
- **Nothing is recorded.** Conch never logs what you type or what a terminal prints.
  Scrollback stays in memory only, and is gone when the terminal ends.
- **Conch's own settings stay out of it.** The shell gets your usual environment,
  without Conch's configuration.

## When something goes wrong

Mostly, you won't notice: Conch fixes it by itself.

- **A shell that stops right away** is usually a broken shell profile. The terminal
  offers **Start without your profile**, so you can open it and fix the profile from
  there. The arrow beside **+** has **Without your shell profile** too.
- **A shell that's gone** (you uninstalled it): Conch uses the next one it finds.
- **A folder that's gone:** the terminal opens in your home folder instead.
- **A dropped connection** reconnects by itself, and the screen comes back as it
  was.
- **A graphics problem** switches the terminal to a simpler way of drawing, without
  a flicker.
- If Conch's usual way of running terminals can't load on this computer, it uses a
  Python 3 terminal on macOS or Linux. If neither is available, basic commands
  still work, without full-screen programs. The native library is optional, so
  failing to build it never blocks installation or an update. What it fixed is
  listed with every other repair in Settings → Health, under _Fixed on its own_.

## For developers

- Code lives in `apps/server/src/terminal/` (gateway),
  `apps/web/src/features/terminal/` (app) and
  `packages/nacre/src/patterns/Terminal/` (design system). The decision record is
  [ADR 0015](./adr/0015-terminal.md).
- Shells get `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=conch`,
  so scripts can tell they're inside Conch.
- The e2e journey is `e2e/terminal.spec.ts`. It turns on screen reader support to
  read what the shell printed.
