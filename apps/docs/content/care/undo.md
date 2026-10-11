---
title: Undo
description: Every file your assistant makes, changes or deletes can be put back with one press, from the chat or from Activity.
order: 6
---

Conch copies each file right before your assistant touches it, so you can put it back. It works with every provider.

## Undo from the chat

A reply that changes something ends with **What changed**: "Changed 4 files · committed · pushed to main". Press it to see each change, with **Undo** beside each file.

1. Press **Undo**.
2. Read the preview. Each file says whether it goes back, is removed (the assistant made it) or comes back (the assistant deleted it), line by line.
3. Press **Undo** to confirm.

The file then says **Undone** and offers **Redo**. A file changed several times in one reply goes back to before the reply. Several files can go at once: **Undo all 3 changes**.

What can't be put back, like a pushed commit or a sent email, is listed first.

## From Activity, or anywhere

**Activity**, in the sidebar, shows everything your assistant did in every chat and routine, with **Undo** or **Redo** beside each file change. **Find in activity** searches loosely, so `gpush` finds "git push".

For the newest change, press <kbd>mod+k</kbd> and choose **Undo the last change**. The same preview comes first.

## If you changed the file since

The preview says so, and leaves that file alone:

- **Undo the others** puts back everything else.
- **Undo all, replacing later changes** overwrites your edits too.

## Memories

Activity also lists what your assistant saved to [memory](../features/memory.md). **Forget** removes one. **Remember again** brings it back.

## Good to know

- Copies last 30 days, or less past 1 GB (oldest first). Then the line says **Too old to undo**.
- Copies stay on this computer, readable only by you, and aren't in [backups](./backups.md).
- Never copied: where your keys and passwords live, links, files over 5 MB, and rebuilt folders like `.git` and `node_modules`.
- Direct edits can be undone anywhere. A command's changes are seen only inside your work folder.
- In a very large work folder (over 10,000 files or 200 MB, or your home folder), only direct edits can be undone.
- An undo never writes through a link, or into a folder that now points elsewhere.
- [Repair everything](./health.md) shows how many changes can still be undone.
