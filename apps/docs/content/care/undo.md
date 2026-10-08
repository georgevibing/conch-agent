---
title: Undo
description: Every file your assistant makes, changes or deletes can be put back with one press, from the chat or from Activity.
order: 6
---

Your assistant changes files for you, and sometimes it changes the wrong one. Conch keeps a copy of each file right before the assistant touches it, so you can put it back. It works the same with every provider.

## Undo from the chat

When a reply changes something, its end shows **What changed**: one line such as "Changed 4 files · committed · pushed to main". Press it to see each change, with an **Undo** button beside each file.

1. Press **Undo**.
2. Read the preview. Each file says what will happen: it goes back to how it was, it's removed because the assistant made it, or it comes back because the assistant deleted it. The change is shown line by line.
3. Press **Undo** to confirm.

The file then says **Undone** and offers **Redo**, which works the same way in the other direction. A file the assistant changed several times in one reply goes back to how it was before the reply.

When a reply changed several files, the list also offers to undo them all at once, for example **Undo all 3 changes**.

What can't be put back from Conch, like a commit pushed to GitHub or an email sent, is listed first, so you see it at a glance.

## From Activity, or from anywhere

**Activity**, in the sidebar, shows everything your assistant did in every chat and routine. Each change to your files has **Undo** or **Redo** beside it. To find something, type in **Find in activity**: it looks through all of it, loosely, in what happened and the chat it happened in, so `gpush` finds “git push”.

To undo the newest change without looking for it, press <kbd>mod+k</kbd> and choose **Undo the last change**. You see the same preview first.

## If you changed the file since

Conch notices when a file is no longer how the assistant left it, and says so in the preview. That file is left alone:

- **Undo the others** puts back everything else.
- **Undo all, replacing later changes** also replaces the file you edited. Choose it only if you don't need those later edits.

## Memories

Activity also shows what your assistant saved to [memory](../features/memory.md). **Forget** removes a memory it saved. **Remember again** brings one back.

## Good to know

- Copies are kept for 30 days, or less once they pass 1 GB: the oldest go first. After that the line says **Too old to undo**.
- Copies stay on this computer, readable only by you. They aren't in [backups](./backups.md).
- Conch never keeps a copy of where your keys and passwords live. It also skips links, files over 5 MB, and folders that are rebuilt anyway, such as `.git` and `node_modules`.
- A file the assistant edits directly can be undone wherever it is. What a command changes is only seen inside your work folder.
- In a very large work folder (over 10,000 files or 200 MB, or your whole home folder), only the assistant's direct edits can be undone.
- An undo never writes through a link, or into a folder that now points somewhere else.
- [Repair everything](./health.md) says how many changes can still be undone.
