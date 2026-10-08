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

A manager that asks for your OK in its own window, such as 1Password, is only asked while you have **Passwords** open. Anywhere else in Conch you see what it showed last, and nothing pops up. How long its OK lasts is the manager's to decide: 1Password asks again after ten minutes without use, and on Windows each time Conch restarts.

### 1Password on a computer without the app

1Password connects two ways. Choose one with **Turn on** (or **Settings**) beside 1Password in **More → Password managers…**:

- **Use the 1Password app on this computer.** Unlock with Touch ID or Windows Hello. In the 1Password app, turn on **Settings › Developer › Integrate with 1Password CLI**.
- **Use a service account token.** For a computer without the 1Password app, such as a server. Conch reads only the vaults you give the service account, and asks nobody for an OK.

To make a token:

1. On 1Password.com, open **Developer › Service accounts**.
2. Create a service account. Choose the vaults Conch may see, with read access.
3. Copy the token it shows (it starts with `ops_`) and paste it in Conch.

Conch tries the token first and says what it found: **Connected · 2 vaults**. It keeps the token sealed on this computer, hands it only to 1Password's command line, and never shows it again. 1Password's own steps are in [its guide](https://developer.1password.com/docs/service-accounts/get-started/).

The row then says **Service account · 2 vaults**. **Settings** chooses which of its vaults Passwords shows, replaces the token, switches back to the app, or disconnects, which forgets the token. If the token stops working, **Repair everything** says so, with **Replace the token**. Both ways need 1Password's command line tool; Conch offers to get it.

Each of these managers is an app in **Apps** too, under **Passwords**. One you turned on has a card there, and its page has the same switch: **Fill sign-ins from** and its name. 1Password has a second switch, **Manage Environments**, for developers. See [Apps](./apps.md#1password). A manager this computer can't run, such as the macOS Keychain on Windows, isn't offered.

**Copy into Conch** makes a manager's items Conch's own, so they are in your vault and your backups. Copy them all from **More → Password managers…**, where Conch can keep them up to date, one way, every 30 minutes. Or copy one or a few: right-click an item, or press **Copy into Conch** on its page. No export file is made.

It works the other way too. Right-click one of Conch's own and choose **Copy to 1Password** or **Copy to Bitwarden**: Conch makes a new item there through that manager's own program, in the vault you pick. Nothing already in the manager is changed. The copy is separate from then on, so a change in one place doesn't follow it to the other. One that's already there, with the same site and account, is left out.

Apple Passwords, Chrome and other browsers don't let other apps read them. Import from those instead.

## Find, check and tidy

One search box finds an item by anything you'd remember: its name, the account, the site, a tag. Press <kbd>/</kbd> to go to it. The best match comes first, with the part that matched marked. <kbd>↓</kbd> and <kbd>↑</kbd> walk through what was found while you keep typing, and <kbd>Enter</kbd> opens the first one.

Each item's tile has a small mark on its corner that says where it lives: Conch's pearl, or the mark of the manager it comes from. Its page says it in words. When the same account is in two places, its page says **Also in** and links to the other one.

The row under the search shows one place at a press: **All**, **Conch**, or one manager, each with how many items it holds. The filter below it narrows the list further, to one kind, one tag, **Favourites** or **One-time codes**. Passwords remembers where you left them. A long list has a heading over each group: **Favourites**, then each letter, or how long ago when you sort by **Recently edited** or **Recently used**.

On a phone, an item opens on a page of its own, with **Passwords ›** and its name at the top: press **Passwords** to go back to the list.

Drag the line between the list and the item to make the list as wide as you like; Passwords remembers it, and a double-click puts it back. The list stays quick however many items it holds. An item's name shows the moment you choose it. Its fields follow, which can take a second when they come from another manager.

**More → Check for breaches** looks for your passwords among known data breaches. No password leaves your computer for it, only a short piece of a scrambled copy. What needs attention shows at the top of the list, worst first: **In a data breach**, **Reused**, **Weak**, **Expired**, **Not secure**. Press one to see those items.

## Do things to one item or many

Right-click an item, or press and hold on a phone, for what you'd do with it: copy its username, password, one-time code or website, open the website, add it to **Favourites**, edit it, copy it to or from another manager, or delete it. With an item chosen or open, <kbd>mod+c</kbd> copies its password, <kbd>mod+shift+c</kbd> its username and <kbd>mod+alt+c</kbd> its one-time code.

To work on several, <kbd>mod</kbd>-click them, or <kbd>shift</kbd>-click to take everything in between. **Select** (the tick beside the sort button) and <kbd>mod+a</kbd> do the same. A bar over the list says how many are chosen and what can be done with them, such as **Copy into Conch**, **Copy to…** and **Delete**. A manager's items are deleted in that manager's own app, so **Delete** says how many of Conch's it will delete. <kbd>esc</kbd> or **Done** ends it.

A deleted item goes to **Recently deleted** for 30 days. **Undo** in the message brings it straight back, and **Restore** does later.

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
