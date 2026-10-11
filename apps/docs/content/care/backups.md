---
title: Backups
description: Conch backs itself up every day. Restore one to go back in time, or carry your Conch to a new computer in one file.
order: 2
---

Conch backs itself up once a day: your settings, memories, routines, skills, integrations and chats. Restore one to go back in time, or download one to move to a new computer.

## Every day, by itself

**Settings → Health → Backups** says **Backed up automatically**, and when.

- One a day, when Conch isn't busy.
- Kept in the Conch folder on this computer: one a day for a week, then one a week for a month.
- Never your keys or sign-ins. Those are already here.

The card's switch turns daily backups off. If one fails, for example on a full disk, the card says why and Conch tries again later.

## Back up to a file

Press **Back up now**, choose, then press **Download backup**:

- **Include chats** is on, and shows how much room they take. Turn it off for a smaller file.
- **Include keys and sign-ins** is off. Turning it on asks for a passphrase of at least 15 characters, twice, which locks your keys.

The file ends in `.conchbackup`. Keep it private: it holds your chats and memories. The download button beside a daily backup saves that one as a file.

> [!WARNING]
> Conch can't recover a forgotten passphrase. Without it, everything except your keys and sign-ins still restores.

## Restore a backup

1. Press **Restore…** beside a backup, or **Restore from a file…**.
2. Read what comes back, what stays, and anything that can act for you, such as an integration that runs a program here.
3. If its keys are locked, type the passphrase, or choose **Forgot it? Restore without keys and sign-ins**.
4. Press **Restore**. If you sign in to Conch, confirm it's you.

Conch restarts and the page comes back. Where it can't restart itself, it says so and waits for you.

Each kind of thing is replaced whole, so anything added since goes too. What the backup doesn't hold, such as chats you left out, stays. So does a password or access keys this Conch already uses for signing in.

## Undo a restore

Conch keeps a copy of what was there first. A notice then offers **Undo**, and Backups keeps an **Undo restore** button.

The copy, marked **Before a restore**, never leaves this computer. Conch keeps the two newest, for up to 30 days.

## Move to a new computer

1. On the old one, press **Back up now** with **Include keys and sign-ins** on.
2. On the new one, [install Conch](../start/install.md).
3. Press **Restore from a file…** and choose the file.

Your password comes along, so you [sign in](../security/signing-in.md) as before. Access keys don't: make new ones.

## Good to know

- Not in a backup: files in your work folder, the browser's sign-ins to websites, and [Undo](./undo.md)'s copies.
- Some providers keep their own record of a chat. A restored chat reads in full, but such a provider may not remember it when the chat carries on.
- Only restore a backup you made. One without a passphrase can't prove where it came from.
- Backup files can be up to 2 GB.
- [What's in the Conch folder](../reference/files.md) lists every file and what a backup does with it.
