---
title: The app
description: Conch as an app for macOS, Windows and Linux. Download it, open it, and it keeps itself up to date.
order: 1.5
---

<!-- conch:download -->

The app is the same Conch as the one-line install, with everything it needs inside: its own copy of Node.js, Conch itself and the web app. It keeps your things in the same place, `~/.conch`, so your chats, memories and settings are there whichever way you open it.

## Which file

| Your computer                   | The file                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- |
| A Mac with Apple silicon (M1 …) | `Conch-…-mac-arm64.dmg`                                                           |
| A Mac with an Intel chip        | `Conch-…-mac-x64.dmg`                                                             |
| Windows                         | `Conch-…-win-x64.exe`. Windows on Arm runs it too.                                |
| Linux                           | `Conch-…-linux-x64.AppImage` (`arm64` on Arm), or the `.deb` on Debian and Ubuntu |

On a Mac, open the `.dmg` and drag **Conch** into **Applications**. On Windows, open the `.exe`: it installs for you alone, with no administrator. On Linux, make the AppImage runnable (right-click it, **Properties → Permissions**, or `chmod +x`) and open it, or install the `.deb`.

## If your computer asks first

A computer is careful with apps from the internet.

- **macOS** may say it can't check Conch for malicious software. Open **System Settings → Privacy & Security**, find the line about Conch near the bottom, and press **Open Anyway**. It asks once.
- **Windows** may show **Windows protected your PC**. Press **More info**, then **Run anyway**. It asks once.

Each file on the release page also has a record of the build that made it, from the release's own tag. With the [GitHub CLI](https://cli.github.com), `gh attestation verify <file> --repo georgevibing/conch-agent` checks it.

## The window and the menu bar

Closing the window doesn't stop Conch. It keeps running in the menu bar on a Mac, the tray on Windows and the panel on Linux, so your routines run and your phone and chat apps can reach it. Open the app again, or choose **Open Conch** there, and the window comes back where it was.

**Quit Conch** in that menu stops it. So does **Quit Conch** in **Settings → Health → Always on**.

If Conch is already running on this computer, from the one-line install or a checkout, the app shows that one instead of starting a second. When that one stops, the app starts its own.

## Starting when you log in

Turn on **Always on** in **Settings → Health**. The app then starts when you log in, with no window, and waits in the menu bar. See [Always on](../care/always-on.md).

## Updates

The app looks for new releases every hour, and when you come back to it, in the channel you chose in **Settings → Health → Updates**, and says so quietly. **Update Conch** downloads the new version, checks it against the release, installs it and opens it again. Your chats are safe.

A Mac app that isn't signed, and the `.deb`, can't replace themselves. There the button says **Download Conch** and opens the release page; install the new version over the old one. See [Updates](../care/updates.md).

## If it doesn't start

The window says what happened, in a sentence, with **Try again**. **Show what it said** opens the app's log, `~/.conch/logs/app.log`. [Repair everything](../care/health.md) looks at the rest once Conch is running.

## Remove it

- **macOS**: drag **Conch** from **Applications** to the Bin.
- **Windows**: **Settings → Apps → Installed apps → Conch → Uninstall**.
- **Linux**: delete the AppImage, or remove the `conch` package.

Your things stay in `~/.conch`. Delete that folder too if you want them gone.

> [!NOTE]
> The `conch` command comes with the one-line install (in a checkout, it's `pnpm conch`). Everything it does is also in the app's **Settings**.
