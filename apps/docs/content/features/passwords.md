---
title: Passwords
description: Keep passwords in Conch or show the manager you already use. Your assistant signs in for you without ever seeing one.
order: 10
---

Conch keeps passwords encrypted on your computer, and shows the manager you already use. With your OK, your assistant signs in for you and never sees the password.

## Add your passwords

Open **Passwords** in the sidebar:

- **Add a password** saves one. **New** also makes cards, notes, API keys, Wi-Fi, bank accounts and more.
- **Import passwords** takes an export file from a browser or another manager. You see what's new before it saves, and duplicates are left out. Delete the export file afterwards: it isn't encrypted.
- **Connect a password manager** shows another manager's items here, and leaves them where they are.

**Make a strong password**, in the password field, writes one for you.

### Accounts without a password

Some accounts sign in with another one, such as **Sign in with Google**, or with a passkey, your company's single sign-on, or a link sent by email. Their page says so, for example _Signs in with Google · ada@gmail.com_, with **Open** for the Google login it uses. A passkey kept in another manager, which Conch can't use, says where it is.

To set it for one of Conch's own, press **Edit** and choose under **Signs in with**. The password field goes away.

## The managers you already use

<!-- conch:password-managers -->

Turn one on in **More → Password managers…**. Conch reads it through the manager's own program and unlock, and changes nothing there. If the program is missing, Conch offers to get it. One this computer can't run, like the macOS Keychain on Windows, isn't offered.

A manager that asks for your OK in its own window, such as 1Password, only asks while **Passwords** is open. 1Password asks again after ten minutes unused, and on Windows each time Conch restarts.

Apple Passwords and browsers like Chrome don't let other apps read them. Import from those instead.

### 1Password on a computer without the app

Choose how 1Password connects with **Turn on** (or **Settings**) beside it in **More → Password managers…**:

- **Use the 1Password app on this computer.** Unlock with Touch ID or Windows Hello. In the 1Password app, turn on **Settings › Developer › Integrate with 1Password CLI**.
- **Use a service account token.** For a computer without the app, such as a server. Conch reads only the vaults you give the service account, and never asks for an OK.

To make a token:

1. On 1Password.com, open **Developer › Service accounts**.
2. Create a service account with read access to the vaults Conch may see.
3. Copy the token (it starts with `ops_`) and paste it in Conch.

Conch tries it (**Connected · 2 vaults**), seals it on this computer and never shows it again. See [1Password's guide](https://developer.1password.com/docs/service-accounts/get-started/).

The row's **Settings** then picks which vaults show, replaces the token, switches back to the app, or disconnects. If the token stops working, **Repair everything** offers **Replace the token**. Both ways need 1Password's command line tool, which Conch offers to get.

### In Apps

Each manager you turned on also has a card in **Apps**, under **Passwords**, with the switch **Fill sign-ins from** and its name. 1Password adds **Manage Environments**, for developers. See [Apps](./apps.md#1password).

### Copy between managers

**Copy into Conch** makes a manager's items Conch's own, in your vault and your backups, with no export file.

- **All of them:** from **More → Password managers…**. Conch can keep them up to date, one way, every 30 minutes.
- **One or a few:** right-click an item, or press **Copy into Conch** on its page.

The other way, right-click one of Conch's and choose **Copy to 1Password** or **Copy to Bitwarden**. It becomes a new item in the vault you pick, unless one with the same site and account is there. The copies are separate from then on.

## Find, check and tidy

The search box finds an item by name, account, site or tag. Press <kbd>/</kbd> to go to it. <kbd>↓</kbd> and <kbd>↑</kbd> walk the results, and <kbd>Enter</kbd> opens the first.

- A mark on each tile shows where it lives. An item's page says where in one line, such as _Stored in 1Password_, with **Copy into Conch**. An account in two places shows **Also in** there.
- Search by how an item signs in ("google", "passkey", "sso"), or choose **Sign in with Google** and the like in the filter.
- The row under the search shows **All**, **Conch** or one manager. The filter narrows to one kind, one tag, **Favourites** or **One-time codes**.
- Drag the line between list and item to resize it; double-click to reset.

**More → Check for breaches** looks for your passwords in known data breaches. Only a short piece of a scrambled copy leaves your computer. What needs attention shows at the top, worst first: **In a data breach**, **Reused**, **Weak**, **Expired**, **Not secure**.

## Do things to one item or many

Right-click an item, or press and hold on a phone, for everything you can do with it. With an item chosen:

- <kbd>mod+c</kbd> copies its password.
- <kbd>mod+shift+c</kbd> copies its username.
- <kbd>mod+alt+c</kbd> copies its one-time code.

To choose several, <kbd>mod</kbd>-click or <kbd>shift</kbd>-click them, or press **Select** or <kbd>mod+a</kbd>; <kbd>esc</kbd> or **Done** ends it. A bar offers **Copy into Conch**, **Copy to…** and **Delete** (only Conch's own; another manager's are deleted in its app).

A deleted item stays in **Recently deleted** for 30 days. **Undo** brings it back at once, **Restore** later.

## What your assistant can do

Your assistant sees names and sites, never a value. In [Conch's browser](./browser.md), Conch fills sign-ins from Passwords itself, from the managers you connected too.

- **One question per sign-in.** A card asks _Sign in as ada@example.com on example.com?_ Your OK covers the username, the password and the code, page after page. Choose **Sign in**, **Not now**, or **Always for** that site.
- **Several accounts** for one site: the card shows each one. Tap the one to use.
- **Signing up or changing a password:** Conch makes a strong one, saves it in Passwords and types it in. It asks each time. A changed password keeps the old one in its history.
- **One-time codes** come from the item, made on your computer.
- It fills only on the item's own site. Another part of the same site, such as `mail.google.com` for a login saved at `accounts.google.com`, always asks and says where it's saved.
- A page that only looks like one of your sites, such as `paypa1.com`, gets nothing. Your assistant tells you instead.
- It never fills a page without https, or a sign-in box from another site inside a page.
- Each item sets how far your assistant may go, under **Your assistant** when you edit it: ask each time, fill without asking, or never.
- A payment card always asks, and fills the card's boxes together.
- For a sign-in you haven't saved, a card in the chat asks you. What you type goes to Passwords, not the chat.
- To read something itself, such as a PIN or a note, it asks: **Don’t**, **Always for this item** or **Allow once**.
- Passkeys are kept with their logins. After asking, your assistant signs in with one in Conch's browser, on that site only, and can save a new one a site offers. It never sees the key.

### When you drive the browser

Take over and click a sign-in box: a bar offers what's saved for that site. Press an account to fill it, or **Use a strong password** on a sign-up form. On a page that only looks like one of your sites, the bar warns you instead.

## Lock it and keep it safe

A value hides again 30 seconds after you show it. A copied one leaves the clipboard after a minute. On another device, seeing a value needs a sign-in from the last five minutes.

For a lock of its own, open **More → Lock settings…** and turn on **Ask for a password to open Passwords**. It locks after 30 minutes unused, or the time you choose. If your assistant needs Passwords while it's locked, the chat shows **Passwords is locked**, with a place to unlock it.

> [!WARNING]
> Nobody can reset that password, Conch included. Forget it, and your passwords only come back from a backup made with a passphrase.

## Good to know

- Passwords are in a [backup](../care/backups.md) only when you give it a passphrase.
- The keys Conch uses for providers, apps and channels are listed as **Keys Conch uses**. They keep working while Passwords is locked.
- <kbd>mod+k</kbd> has **New password**, **Generate a password**, **Import passwords** and **Check my passwords**. See [Find anything](./find.md).
