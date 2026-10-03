# 0062 — Copy to another password manager, and Passwords you can work in

- Status: accepted
- Date: 2026-10-03
- Amends: [ADR 0025](./0025-passwords.md) (other password managers are read-only)

## Context

Passwords shows Conch's own vault and the managers people already use as one list (ADR 0025).
With 1Password connected that list was 769 rows, and nothing on a row said whose it was: two
"yazio" logins sat one above the other, one Conch's and one 1Password's, and only opening each
told them apart. A manager's mark showed only when two managers were on, never Conch's own.

The list also did one thing at a time. A right-click opened the browser's menu. Copying an item
into Conch meant the Sources dialog and every item at once. Deleting twenty items was twenty trips
to an item's ⋯ menu. And an item could only move one way: from a manager into Conch, never back.

People who keep 1Password as their main manager, and try Conch's vault beside it, asked for the
other way too: "copy an individual item from 1Password to Conch and/or the other way".

## Decision

### Where each item lives, on every row

A small badge on the corner of each row's tile says where the item lives: Conch's pearl, the
manager's mark, or a lock for the keys Conch uses. It shows once the list holds more than one
place's items. The row's name says it to a screen reader ("Mail, ada, from 1Password, Private";
"Bank, ada, in Conch"), and the item's page says it in words next to its kind.

A row of places under the search (**All**, **Conch**, **1Password** …, each with its count) shows
one place's items at a press. The kind and tag filter works within the place chosen. The place,
filter and sort are remembered in this browser, Recently deleted excepted.

The same account in two places (the same site, or title, and the same account; no password
compared) is linked from each item's page: **Also in 1Password · Private**.

### Doing things to one item or several

- **Right-click** (or a long press) on a row: open it; copy its username, password, one-time code
  or website; open the website; favourite, edit, delete; **Copy into Conch** or **Copy to
  1Password**; **Select**.
- **Choosing several**: ⌘/Ctrl-click, Shift-click a run, **Select** (the tick icon), or ⌘/Ctrl+A in
  the list. The tiles become tick boxes, and a bar says how many are chosen, offers **Select all**,
  and what can be done with them. Each button says how many it applies to when that isn't all of
  them: a manager's items are copied into Conch but deleted in their own app.
- **Keys**: ⌘/Ctrl+C copies the password of the item with focus or open, ⇧ the username, ⌥ the
  one-time code (1Password's own keys); Delete moves Conch's own to Recently deleted; Esc ends a
  choice.
- Deleting is never asked about: it goes to Recently deleted with **Undo** in the toast. Deleting
  for good is still asked about.

### Copy to: Conch's items into another manager

A manager may now take one kind of write: a **new item**, made from one of Conch's own when the
person chooses **Copy to <manager>**. `PasswordSource.add` is optional; 1Password and Bitwarden
have it, and only they are offered.

- **Values on stdin, never in argv.** 1Password gets its own item template on stdin
  (`op item create --vault <id> -`, which its documentation recommends over assignments because
  arguments are visible to other processes). Bitwarden gets the encoded item on stdin
  (`bw create item`, which reads it there when it isn't an argument). Tests prove no secret
  reaches an argument.
- **Only a person.** The route (`POST /api/vault/sources/:id/copy`) needs a recent sign-in, like
  an export, because it sends passwords to another program. The assistant has no tool for it;
  nothing in `vault/tools.ts` changed.
- **New items only.** Nothing in the manager is edited, moved or deleted. A copy is separate from
  then on: change it in either place.
- **No duplicates by surprise.** An item copied from that manager, or with the same site and
  account as one of its items (names only, from its list), is left out unless asked.
- **Where it goes.** 1Password's vaults are read from the list it already gave (no extra call that
  could raise its approval window); with more than one, the menu asks which.
- **A few at a time.** The page sends at most 25 per request (10 in practice) so the toast can say
  how far it got, and stops at the first "locked".

## Consequences

- AGENTS.md § Adding a password manager: "Read-only" becomes "Read-only, but for Copy to". A new
  manager can offer `add` if its program takes a new item on stdin; otherwise it's left out.
- The managers' own apps stay where edits happen. Copy to doesn't sync: a later change in Conch
  doesn't follow the copy, and that's said in the toast.
- KeePassXC, Proton Pass, Dashlane, Keeper and the Keychain are still only read. Their programs
  either take values as arguments or need a prompt we can't answer on stdin.
- Context menus are an accelerator: every action in one is also on the item's page or in the bar
  over chosen items.
