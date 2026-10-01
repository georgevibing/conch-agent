---
title: Always on
description: Conch starts when you log in and runs with no window, so routines run on time and your phone can always reach it.
order: 4
---

With Always on, Conch starts by itself when you log in and keeps running with no window. Routines run on time, and your phone and chat apps can reach it while you're away. If you used [the one-line installer](../start/install.md), it's already on.

## Turn it on

Open **Settings → Health → Always on** and turn on the switch. Conch may ask you to confirm it's you, because it will then run with nobody watching.

If Conch is running in a Terminal window, it moves itself to the background without losing your place. The page rests for a moment and comes back by itself. After that, you can close the window.

The section now says **Starts when you log in**, and where your computer lists it: **System Settings → General → Login Items** on a Mac, **Task Manager → Startup apps** on Windows. If Conch ever crashes, it starts again by itself.

Turning the switch off never stops the Conch you're using. It only stops Conch starting by itself the next time you log in.

## Open it like any app

**Conch** is where your other apps are: Applications and Spotlight on a Mac, the Start menu on Windows, the app menu on Linux. Opening it opens Conch in your browser. If Conch isn't running, the app starts it first.

The installer adds it for you. If it's missing, **Settings → Health → Always on** has a button that puts it there: **Add Conch to Applications** on a Mac.

## The pearl in the menu bar

A small pearl sits in the menu bar on a Mac, the tray on Windows and the panel on Linux. It shows whether Conch is running, and wears a dot when a question or a new device is waiting for you.

Its menu has **Open Conch**, **Quit Conch** and, when Conch is stopped, **Start Conch**. The pearl stays after you quit, so starting again is one click.

To hide it, turn off **Show Conch in the menu bar** in **Settings → Health → Always on**. On Windows and Linux, the switch says "tray" or "panel" instead. On a Mac, the pearl needs Apple's Command Line Tools. If they're missing, the switch says so and helps you get them.

The pearl can only ask how Conch is and quit it. It sees counts, never anything from a chat. Anything that needs you to confirm it's you opens Conch's page instead.

## Quit Conch

Press **Quit Conch** in **Settings → Health → Always on**, or in the pearl's menu. If a chat is still working, Conch asks you to wait for it to finish. Once Conch has stopped, your other devices, chat apps and routines can't reach it until it's open again.

To start it again, open **Conch** from your apps, or press **Start Conch** in the pearl's menu. With Always on, it also starts at your next login. A page you left open comes back by itself.

## A computer that stays on

For a Mac mini or a Raspberry Pi in a cupboard, [install with `--server`](../start/install.md). Two more switches in **Settings → Health → Always on** help, each shown only where it means something:

- **Keep running after you log out**, on Linux. Routines run and your phone reaches Conch with nobody logged in. If your computer wants an administrator for that, Conch shows the one command to copy.
- **Keep this Mac awake**. On mains power, the Mac won't sleep while Conch runs in the background.

A Mac and Windows stop what you run when you log out. Stay logged in and lock the screen instead. On a Mac that stays on, turn on automatic login in **System Settings → Users & Groups**.

## Good to know

- Prefer the terminal? `pnpm conch background`, `quit`, `shortcut` and `tray` do the same. See [the command line](../reference/cli.md).
- [Repair everything](./health.md) checks Always on, and updates how Conch starts if something moved.
- Restoring [a backup](./backups.md) never turns Always on on. You switch it on yourself, on each computer.
