---
title: Passwords
description: Keep passwords in Conch or show the manager you already use, and let your assistant sign in without ever seeing one.
order: 10
---

Conch has a password manager of its own, encrypted on your computer. It also shows what's in the manager you already use. Your assistant can sign in to a site for you, with your OK, and never sees the password.

## Add your passwords

Open **Passwords** in the sidebar. There are three ways to fill it:

- **Add a password** saves one. **New** also makes cards, notes, API keys, Wi-Fi, bank accounts and more.
- **Import passwords** takes the export file from a browser or another manager. Conch shows what's in the file and what's already here before it saves anything, and leaves duplicates out. Delete the export file afterwards: it isn't encrypted.
- **Connect a password manager** shows another manager's items here, and leaves them where they are.

When you add or edit a password, **Make a strong password** in its field writes one for you.

## The managers you already use

These are the password managers Conch reads beside its own vault:

<!-- conch:password-managers -->

Turn one on in **More → Password managers…**. Conch reads it through that manager's own program and its own unlock, and changes nothing there. If the program is missing, Conch offers to get it.

**Copy into Conch** makes a manager's items Conch's own, so they are in your vault and your backups. It can keep them up to date, one way, every 30 minutes. No export file is made.

Apple Passwords, Chrome and other browsers don't let other apps read them. Import from those instead.

## Find, check and tidy

One search box finds an item by anything you'd remember: its name, the account, the site, a tag. Press <kbd>/</kbd> to go to it. The filter below it narrows the list to one kind, one manager, one tag, **Favourites** or **One-time codes**.

**More → Check for breaches** looks for your passwords among known data breaches. No password leaves your computer for it, only a short piece of a scrambled copy. What needs attention shows at the top of the list, worst first: **In a data breach**, **Reused**, **Weak**, **Expired**, **Not secure**. Press one to see those items.

A deleted item goes to **Recently deleted** for 30 days, and comes back with **Restore**.

## What your assistant can do

Your assistant sees the names and sites of your items, never a value. When it reaches a sign-in in [Conch's browser](./browser.md) and that site is saved, a card asks whether to fill it: **Fill**, **Not now**, or always for that site. Conch types the password into the page itself.

- It fills a password only on the item's own websites, never on a lookalike.
- Each item says how far your assistant may go, under **Your assistant** when you edit it: ask each time, fill without asking, or never.
- A payment card always asks.
- For a sign-in you haven't saved, it can ask with a card in the chat. What you type there goes to Passwords, not into the chat.
- To read something itself, such as a PIN or a note, it asks in the chat: **Don't**, **Always for this item** or **Allow once**.
- Passkeys are kept with their logins. Your assistant signs in with one in Conch's browser, on that site only, after asking you.

## Lock it and keep it safe

A value stays hidden until you ask for it, and hides again after 30 seconds. A copied one is cleared from the clipboard after a minute. From another device, seeing a value needs a sign-in from the last five minutes.

For a lock of its own, open **More → Lock settings…** and turn on **Ask for a password to open Passwords**. It locks again by itself after 30 minutes unused, or the time you choose. If your assistant needs Passwords while it's locked, the chat shows **Passwords is locked**, with a place to unlock it.

> [!WARNING]
> Nobody can reset that password, Conch included. If you forget it, your passwords only come back from a backup made with a passphrase.

## Good to know

- Passwords are in a [backup](../care/backups.md) only when you give it a passphrase.
- The keys Conch itself uses, for providers, apps and channels, are listed as **Keys Conch uses**. They keep working while Passwords is locked.
- <kbd>mod+k</kbd> has **New password**, **Generate a password**, **Import passwords** and **Check my passwords**. See [Find anything](./find.md).
