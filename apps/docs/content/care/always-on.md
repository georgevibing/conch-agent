---
title: Always on
description: Conch starts when you log in and runs with no window, so routines run on time and your phone can always reach it.
order: 4
---

With Always on, Conch starts when you log in and runs with no window. Routines run on time, and your phone and chat apps reach it while you're away. [The one-line installer](../start/install.md) turns it on for you.

## Turn it on

Open **Settings → Health → Always on** and turn on the switch. Conch may ask you to confirm it's you, because it will run with nobody watching.

If Conch runs in a Terminal window, it moves itself to the background. The page rests a moment, comes back, and you can close the window.

The section then says **Starts when you log in**, and where your computer lists it: **System Settings → General → Login Items** on a Mac, **Task Manager → Startup apps** on Windows. After a crash, Conch starts again by itself.

Turning the switch off never stops the running Conch. It only stops Conch starting at your next login.

## In the app

In [the app](../start/app.md), closing the window already keeps Conch running in the menu bar. Always on also opens it at login, with no window. Nothing moves and the page doesn't rest.

## Open it like any app

**Conch** is with your other apps: Applications and Spotlight on a Mac, the Start menu on Windows, the app menu on Linux. It opens Conch in your browser, starting it first if needed.

If it's missing, **Settings → Health → Always on** has a button to add it, such as **Add Conch to Applications**.

## The pearl in the menu bar

A small pearl in the menu bar (the tray on Windows, the panel on Linux) shows whether Conch is running. A dot means a question or a new device is waiting.

Its menu has **Open Conch**, **Quit Conch** and, when Conch is stopped, **Start Conch**. It stays after you quit, so starting again is one click.

- To hide it, turn off **Show Conch in the menu bar** ("tray" or "panel" on Windows and Linux) in **Settings → Health → Always on**.
- On a Mac it needs Apple's Command Line Tools. If they're missing, the switch helps you get them.
- It sees only counts, never anything from a chat, and can only quit Conch. Anything that needs you to confirm it's you opens Conch's page.

## Quit Conch

Press **Quit Conch** in **Settings → Health → Always on** or the pearl's menu. If a chat is still working, Conch asks you to wait. Until Conch is open again, your other devices, chat apps and routines can't reach it.

To start it, open **Conch** from your apps or press **Start Conch** in the pearl's menu. With Always on, it also starts at your next login. An open page comes back by itself.

## A computer that stays on

For a Mac mini or a Raspberry Pi in a cupboard, [install with `--server`](../start/install.md). **Settings → Health → Always on** then shows two more switches where they apply:

- **Keep running after you log out**, on Linux: routines run and your phone reaches Conch with nobody logged in. If this needs an administrator, Conch shows the command to copy.
- **Keep this Mac awake**: on mains power, the Mac won't sleep while Conch runs in the background.

On a Mac or Windows, logging out stops Conch. Lock the screen instead. On a Mac that stays on, turn on automatic login in **System Settings → Users & Groups**.

## Good to know

- `conch background`, `quit`, `shortcut` and `tray` do the same in a terminal. See [the command line](../reference/cli.md).
- [Repair everything](./health.md) checks Always on, and fixes how Conch starts if something moved.
- Restoring [a backup](./backups.md) never turns Always on on. Switch it on yourself, on each computer.
