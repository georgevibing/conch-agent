---
title: Backups
description: Conch backs itself up every day. Restore one to go back in time, or carry your Conch to a new computer in one file.
order: 2
---

Conch backs itself up once a day without being asked. A backup holds what you would miss: your settings, memories, routines, skills, integrations and chats. Restore one to go back in time, or download one and take your Conch to a new computer.

## Every day, by itself

Open **Settings → Health** and find **Backups**. The card says **Backed up automatically**, and when the last one was made.

- A backup is made once a day, when Conch isn't busy.
- It stays on this computer, in the Conch folder.
- Conch keeps one a day for a week, then one a week for a month.
- It never holds your keys or sign-ins. Those are already on this computer.

The switch on the card turns daily backups off. If a backup can't be made, because the disk is full for example, the card says why in one sentence and Conch tries again later.

## Back up to a file

Press **Back up now**. You choose two things, then press **Download backup**:

- **Include chats** is on, and shows how much room your chats take. Turn it off for a smaller file.
- **Include keys and sign-ins** is off. Turn it on and choose a passphrase of at least 15 characters, typed twice. Your keys are locked with it.

The file's name ends in `.conchbackup`. Keep it somewhere private: it holds your chats and memories. The download button beside a daily backup saves that one as a file too.

> [!WARNING]
> Conch can't recover a forgotten passphrase. Without it, everything except your keys and sign-ins still restores.

## Restore a backup

1. Press **Restore…** beside a backup in the list, or **Restore from a file…** to choose one you downloaded.
2. Read what comes back. Conch lists it in plain words, says what stays as it is, and names anything in the backup that can act for you, such as an integration that runs a program on this computer.
3. If the backup's keys are locked, type its passphrase. Without it, choose **Forgot it? Restore without keys and sign-ins**.
4. Press **Restore**. If you sign in to Conch, it asks you to confirm it's you.

Conch starts again and the page comes back by itself. Where Conch can't restart itself, it says so and waits for you to restart it.

A restore replaces each kind of thing as a whole, so what you added since goes with it. What the backup doesn't hold, such as chats you left out, stays as it is. If this Conch already has a password or access keys for signing in, those stay too.

## Undo a restore

What was in your Conch is kept before anything is replaced. When the page comes back, a notice offers **Undo**, and the Backups section keeps an **Undo restore** button.

That copy is marked **Before a restore** in the list. It never leaves this computer. Conch keeps the two newest, for up to 30 days.

## Move to a new computer

1. On the old computer, press **Back up now** with **Include keys and sign-ins** on.
2. On the new one, [install Conch](../start/install.md).
3. Press **Restore from a file…** and choose the file.

Your password comes with it, so you [sign in](../security/signing-in.md) as before. Access keys don't come over, so make new ones.

## Good to know

- Files in your work folder aren't in a backup. Neither are the browser's sign-ins to websites, or the copies [Undo](./undo.md) keeps.
- Some providers keep their own record of a chat outside Conch. On a new computer a restored chat is all there to read, but such a provider may not remember it when the chat carries on.
- Only restore a backup you made. One without a passphrase can't prove where it came from.
- Conch restores backup files of up to 2 GB.
- [What's in the Conch folder](../reference/files.md) lists every file and what a backup does with it.
