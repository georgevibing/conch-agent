# 0016 — Getting what a feature needs

- Status: accepted
- Date: 2026-09-30

## Context

Some features lean on something outside Conch. 1Password's Environments server
comes with the 1Password app. A provider needs its CLI. A catalog integration
may need Node, `uv` or Docker. Until now each of these ended in a sentence
like “Couldn't find “1password-mcp” on this computer.” and a **Try again**
button. That is a dead end twice over: the person has to work out what to
install and how, and pressing Try again changes nothing until they do.

It was also wrong. On the machine where the problem was reported, 1Password
(MSIX, 8.12.36 from winget) had installed `1password-mcp.exe`, but only as a
Windows **app execution alias** in `%LOCALAPPDATA%\Microsoft\WindowsApps`.
Following that link lands in a folder only Windows may open, so `fs.existsSync`
reports it missing. Starting it works. On macOS the same program lives inside
`/Applications/1Password.app/Contents/MacOS`, which is not on `PATH`. 1Password's
docs (Sept 2026) still list only macOS and Linux, but the Windows app ships the
server.

The browser (ADR 0014) already shows the shape we want: it finds what's there,
downloads what isn't with progress, and never asks the person to debug.

## Decision

A feature declares its **needs**. Conch finds them where they really live,
offers to install them, and notices by itself when they arrive.

- **A need knows where it lives** (`apps/server/src/setup/known.ts`): on `PATH`
  (app aliases included, see `presentSync` in `lib/proc.ts`), in a macOS app bundle,
  or where an older installer put it. The found path is the one that runs.
  Integrations resolve their program through it (`CatalogItem.program`), so an app
  bundle that isn't on `PATH` works.
- **Conch installs what it can, as you.** A need may have a recipe per platform for
  a package manager that needs no administrator: winget on Windows, Homebrew on
  macOS. It is offered only when that manager is on this computer. The recipe is a
  fixed argument array in code, never built from input, and runs without a shell
  (`setup/needs.ts`). Installs are single-flight per need, time out after 15
  minutes, and report the installer's own progress. Failures come back in plain
  words (offline, cancelled, no disk space, needs an administrator), and the
  website link stays in view.
- **What it can't install, it links to**, then looks again every few seconds and
  whenever you come back to the window. Linux packages need `sudo`, so Linux gets
  the download link.
- **Switches only a person can flip** (1Password's “Enable local MCP server”) are
  the last step. They come with an **Open 1Password** button, and Conch checks
  again when you return to the window. When everything is installed but the program
  won't start, the card says which switch (`CatalogItem.switchedOff`), not
  “It stopped while starting up.”
- **Health carries it.** An integration waiting on a need has
  `health.action: 'setup'` and a short message (“Needs the 1Password app.”). Its card
  offers **Finish setup**, which opens the connect dialog on the integration you
  already added. When an install lands, Conch checks the integrations waiting on it,
  so their cards heal by themselves.
- **One UI for it**: Nacre's `SetupChecklist` pattern. Every need is a step with its
  state in words, at most one button, and progress while it installs. The dialog's
  main button is always the next thing to do: Install → Open → Connect.

### Routes

`GET /api/integrations/catalog/:catalogId/needs` returns `Readiness`.
`POST …/needs/:needId/install` and `POST …/needs/:needId/open` act on one need of
that entry only.

## Security

Installing software persists power beyond a chat, so `install` needs a recent
password or key (the same “sudo mode” as adding a command), and only a person
pressing the button can start it. The agent has no tool for it. Recipes and
package ids are constants, so a web page, the agent or a settings file cannot choose
what gets installed. `open` starts only an app a need already found, detached, with
the scrubbed environment (`agentEnv`). The confirmation shows the exact command
before it runs. Accepting the package's terms (`--accept-package-agreements`)
happens because the person pressed “Install 1Password”.

## Consequences

- A new need is one entry in `setup/known.ts`, and a catalog entry lists it in
  `needs`. The next consumers are the provider CLIs (Claude Code, Codex), the
  1Password CLI `op`, and `npx` or `uvx` for catalog servers (see AGENTS.md
  agreement 11).
- Conch now runs winget or Homebrew when asked, and may open an app on the
  gateway's computer.
- `HealthAction` gains `setup`, and `Need`/`Readiness` join the protocol.

## Sources

- 1Password Environments MCP server docs, and the 1Password Kiro plugin for the
  macOS path. Checked on a real Windows 11 install: `winget show AgileBits.1Password`
  (MSIX 8.12.36) puts `1Password.exe` and `1password-mcp.exe` in `WindowsApps`.
- Microsoft: app execution aliases are `IO_REPARSE_TAG_APPEXECLINK` reparse points;
  winget `--disable-interactivity` and its agreement flags.
- OWASP ASVS 5.0 V8 (authorization of sensitive operations). A step-up
  re-authentication before an action that persists privilege follows NIST SP
  800-63B-4 §2.2 (reauthentication).
