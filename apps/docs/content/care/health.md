---
title: Repair everything
description: One button looks at every part of Conch, fixes what it can, and names the one thing only you can do.
order: 1
---

Conch fixes most problems before you notice them. What it can't fix ends in one plain sentence with one button, in one place.

## The one button

Open **Settings → Health** and press **Repair everything**, or find it with <kbd>mod+k</kbd>. Conch checks every part of itself at once and fixes what is safe to fix. Results fill in within seconds.

A repair never deletes anything or signs you out. **Check again** only looks.

## What it looks at

When all is well, it says **Everything's working**. Each group is one line, like **5 working**. Press one to open it. A group that needs you opens by itself, at the top. Opened groups stay open until you close the tab.

- **Providers**: installed, signed in and answering.
- **Apps**, **Other apps** and **Talk to me here**: your apps, chat apps and apps using Conch still work.
- **This computer**: the browser, search, the internet, disk space, whether Conch's files are private, and **Staying responsive**: room for more work, and what Conch did after a slowdown or restart. If Conch stopped answering this week, **Stopped answering** says how often, and where in its own code it was stuck the last time. If it keeps happening, that line is the useful one to share.
- **Your data**: [backups](./backups.md), passwords, memory and [undo](./undo.md).
- **Updates**: Conch and its programs. See [Updates](./updates.md).
- **Conch**: your agents, outside agents and [dashboards](./dashboards.md).
- **Skills**: skills you added from Discover.
- **Routines** and **Tasks**: anything waiting for you.

## When it needs you

What Conch couldn't fix opens first in its group, with one sentence and one button: sign in again, install or update a program, open the right page, copy the command only you can run, or **Repair**. **Repair everything** stands out only while there's something to fix.

News, like a new version, never counts as a problem. Neither does something you turned off.

## Fixed on its own

At the foot of the page, **Fixed on its own** counts this week's fixes and lists the latest, like **Restarted the browser**, each marked with the part it was in. Every part's fixes are here, and only here. Repeats show once, with a count. **Show all** opens the rest. Nothing in it needs you.

Without asking, Conch:

- starts again after a crash;
- holds heavy commands while this computer is busy, and stops a managed command if memory pressure stays high;
- checks its web connection responds, reduces managed work if not, and restarts if that doesn't help;
- moves to the next free port when another program takes its usual one;
- sets aside a damaged file of its own and carries on with what still reads;
- renews an expired sign-in to a connected app, and retries a service that was briefly down;
- reconnects a dropped bot;
- sends a message held while you were [offline](./offline.md) once you're back.

## When this computer is busy

As this computer nears its memory or CPU budget, Conch tells active assistants. They can run fewer jobs at once, use smaller batches, or keep reading and planning.

- **Progress is kept.** Updates arrive as tools finish. A provider that can't take one between its own tools gets it with the next Conch tool or the next turn.
- **Commands wait.** They show **Waiting to start** with a reason, and keep their place. Stopping the chat cancels them. A stopped or expired command never starts later.
- **The assistant knows why.** A held shell command is reported as not run, with why (busy processor or short memory) and when commands run again. So the assistant waits instead of retrying. A held command never counts against a task.
- **Work returns gradually.** Once there's room for a while, Conch restores managed work step by step and tells the assistant to carry on. Chats share that allowance, so heavy work doesn't all restart at once.
- **Settings → Health** shows whether managed commands are slowing, waiting or recovering.

Resource updates never answer an approval for you, or let an assistant raise system limits.

If memory pressure stays high, Conch may stop one of its managed commands to protect the rest. Its output stays in the chat. Conch never stops other applications, or reruns the command by itself.

On Linux, Conch also checks memory limits shared with other services, since free memory elsewhere doesn't mean its own services have room. When a gateway stops, its supervisor cleans up its programs so they don't linger after a restart.

After a restart, interrupted chats resume gradually. If Conch can't tell whether an action finished, it asks you to check. It never repeats a change that may have happened, or answers a question for you.

## After repeated trouble

Conch starts with background work paused, so your chats and settings still open. Routines, automatic learning and managed commands wait, and **Settings → Health** explains why.

- After a full minute responding with room to work, waiting work continues by itself. **Repair everything** checks sooner.
- Crash history is kept through a longer calm stretch, so brief recoveries don't cause endless restarts.
- If Conch can't start even paused, its supervisor waits before trying again.

Freeze detection runs in the supervisor behind the background service, `pnpm start` and the desktop app. A development gateway started directly has resource protection, but nothing to restart it if its event loop freezes.

## A program a feature needs

When a feature needs a program that isn't part of Conch, a missing one gets a button, not an error.

- **It looks first**, and runs the copy it finds wherever it was installed.
- **It installs what it can.** **Install** and the program's name, with the command and its progress. Only what needs no administrator. Whatever was waiting then carries on.
- **It links to the rest.** For what only you can install, Conch links to its website and notices when it arrives.
- **It points at the switch.** For a program turned off inside another app, Conch names the setting and offers to open that app.

Only your press starts an install. Your assistant can't install anything. If you [sign in to Conch](../security/signing-in.md), it asks you to confirm it's you first.

The full list is in [Programs Conch gets for you](../reference/programs.md).
