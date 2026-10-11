---
title: The app
description: Conch as an app for macOS, Windows and Linux. Download it, open it, and it keeps itself up to date.
order: 1.5
---

<!-- conch:download -->

The app is the one-line install's Conch with everything inside, Node.js included. It shares `~/.conch`, so your chats, memories and settings are there whichever way you open Conch.

## Which file

| Your computer                   | The file                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- |
| A Mac with Apple silicon (M1 …) | `Conch-…-mac-arm64.dmg`                                                           |
| A Mac with an Intel chip        | `Conch-…-mac-x64.dmg`                                                             |
| Windows                         | `Conch-…-win-x64.exe`. Windows on Arm runs it too.                                |
| Linux                           | `Conch-…-linux-x64.AppImage` (`arm64` on Arm), or the `.deb` on Debian and Ubuntu |

- **Mac:** open the `.dmg`, drag **Conch** into **Applications**.
- **Windows:** open the `.exe`. It installs for you alone, no administrator.
- **Linux:** make the AppImage runnable (right-click, **Properties → Permissions**, or `chmod +x`) and open it, or install the `.deb`.

## If your computer asks first

Each asks once.

- **macOS** may say it can't check Conch for malicious software. In **System Settings → Privacy & Security**, press **Open Anyway** beside Conch, near the bottom.
- **Windows** may show **Windows protected your PC**. Press **More info**, then **Run anyway**.

Each release file has a record of the build that made it. Check it with the [GitHub CLI](https://cli.github.com): `gh attestation verify <file> --repo georgevibing/conch-agent`.

## The window and the menu bar

Closing the window doesn't stop Conch. It stays in the menu bar (Mac), tray (Windows) or panel (Linux), so routines run and your phone and chat apps reach it.

- **Open Conch** there, or opening the app, brings the window back where it was.
- **Quit Conch** there, or in **Settings → Health → Always on**, stops it.

If Conch already runs here, from the one-line install or a checkout, the app shows that one. When it stops, the app starts its own.

## Starting when you log in

Turn on **Always on** in **Settings → Health**. The app then starts at login, windowless, in the menu bar. See [Always on](../care/always-on.md).

## Updates

The app looks for a release every hour and when you come back to it, in the channel chosen in **Settings → Health → Updates** (until you choose, the steadiest one with a release). **Update Conch** downloads it, checks it, installs it and reopens. Your chats are safe.

An unsigned Mac app and the `.deb` can't replace themselves. There the button says **Download Conch** and opens the release page; install over the old one. See [Updates](../care/updates.md).

## If it doesn't start

The window says why, with **Try again**. **Show what it said** opens `~/.conch/logs/app.log`. Once Conch runs, [Repair everything](../care/health.md) checks the rest.

## Remove it

- **macOS:** drag **Conch** from **Applications** to the Bin.
- **Windows:** **Settings → Apps → Installed apps → Conch → Uninstall**.
- **Linux:** delete the AppImage, or remove the `conch` package.

Your things stay in `~/.conch`. Delete it too to remove them.

> [!NOTE]
> The `conch` command comes with the one-line install (`pnpm conch` in a checkout). Everything it does is also in **Settings**.
