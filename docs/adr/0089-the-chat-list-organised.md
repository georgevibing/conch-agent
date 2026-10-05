# 0089 — The chat list, organised: status at a glance, pins, folders, apps that look like apps

- Status: accepted
- Date: 2026-10-05
- Builds on: [ADR 0018](./0018-channels.md) (chats from chat apps),
  [ADR 0033](./0033-hand-it-off.md) (tasks stay out of the list),
  [ADR 0034](./0034-show-me.md) (pinned apps),
  [ADR 0052](./0052-one-app-one-card.md) (the group called Pinned),
  [ADR 0060](./0060-the-chat-knows-conch.md) (waiting for you),
  [ADR 0061](./0061-apps-you-make-share-and-add.md) (Conch apps' pages)
- Amends: ADR 0034 §4 and ADR 0052 on where pinned apps sit: they're a row
  of app tiles at the top of the list now, not rows under **Pinned**, which
  is for chats.

## Context

The sidebar was one list, newest first, cut into Today, Yesterday, the last
week and **Earlier**. Everything older than a week went into Earlier. You
couldn't pin a chat. You couldn't put chats together, or change more than one
at a time. A chat that had finished while you were elsewhere looked like one
you'd read. Pinned app pages sat under **Pinned** as rows of the same weight as
chats, so nothing said they were apps.

What people say about AI chat lists is the same everywhere (OpenAI's
community forum, Hacker News, the Claude and Cursor trackers, 2024–2026):

- **A date-sorted list falls apart past a few hundred chats.** "A big list of
  conversations that are hard to distinguish"; "2024 history … dumped into one
  big category called 2024".
- **Folders, not projects.** "Projects is not a solution for this and has a
  completely different goal. Folders is just about categorizing." Extensions
  that add folders keep them in one browser, "so switching PCs breaks the
  structure".
- **Pins with a cap, pins that vanish.** Pinned chats that come undone or
  disappear in a redesign.
- **No bulk archive or delete.** At least eight separate requests on OpenAI's
  forum alone.
- **Agent work needs status.** The most useful things an agent list can show
  are "working", "waiting for you" and "finished, not looked at". Cursor groups
  agents that need attention for this reason. Scheduled runs that pile up as
  loose chats are a common complaint. Conch already keeps routine runs, tasks
  and other apps' calls out of the list (ADR 0033, 0073).
- **Tidying that does itself, undoably.** Arc puts tabs away after a while.
  TypingMind archives after a set time. Codex files empty automation runs by
  itself. People ask for suggestions they can accept or undo, never for
  filing done behind their back.

## Decision

The chat list says at a glance what each chat is doing, keeps what you chose
to keep at the top, and puts the rest in groups small enough to read. Every
part of it works the same on a phone, and every change can be undone.

### 1. Order of the list

From the top:

1. **Pinned apps.** A row of app tiles, like a phone's dock. Each tile is a
   Conch app's page, drawn with the app's own icon, or a page pinned from a
   chat (ADR 0034), drawn with its kind's glyph. The tile's label is the page's
   name. Pointing at a tile, or reading it with a screen reader, says where it
   came from: "Page of the Tally app", or "Made in a chat". Right-click or a
   long press offers **Open**, **About this app** or **Open the chat it came
   from**, and **Unpin**. Before this, a pinned page couldn't be unpinned from
   the sidebar at all.
2. **Needs you.** Chats waiting for your answer (`awaiting-permission`) are
   lifted here until you give it, wherever they normally sit.
3. **Pinned.** Chats you pinned, in an order you set: drag one, or use **Move
   up** and **Move down**. There's no cap.
4. **Folders.** Each has a name and a mark: one of Nacre's glyphs in one of the
   app colours, so a folder reads like the rest of Conch. A folder folds away
   (this device remembers which), shows how many chats it holds, and takes a
   drop. Folders only sort. They don't change how the assistant answers, and
   they hold no files or instructions. That's what projects are, and
   people asked for something lighter.
5. **The rest, by when:** Today, Yesterday, Previous 7 days, Previous 30 days,
   then one group per month ("September", or "August 2025" for another year).
   There is no Earlier any more.
6. **Archived**, and the tidy-up suggestion (§5).

A chat is in exactly one of these places.

### 2. Status at a glance

Each row can carry one mark, and each mark comes with words a screen reader
says, so colour is never the only sign:

- **Working:** the pearl, as before.
- **Needs you:** an amber dot.
- **New:** an accent dot and a heavier title. Something happened since you last
  had the chat open on any device: a reply that finished while you were
  elsewhere, or a message from a chat app.
- **Didn't finish:** a red dot, when the last turn ended in an error.

Chats from a chat app still wear the app's logo.

"New" is kept by the gateway as `seenAt` on the chat, and set when a chat is
in front of you (`PATCH … {seen: true}`, from `useSeen`). Your phone and your
computer agree on it. A chat you start here is seen when you start it. A chat
that starts from a chat app isn't. A chat from before this change has no
`seenAt` and is never new until something happens in it, so the list doesn't
light up on the day this ships.

### 3. Changing many at once

Select chats with ⌘ or Shift and a click, or with **Select** in a chat's menu.
A bar at the foot of the list says how many are selected and offers **Pin**,
**Move to**, **Archive** and **Delete** (which asks first). One request does
it all (`POST /api/conversations/bulk`). Archive and Move to each offer
**Undo**.

### 4. Moving things by hand

- **Drag:** on a computer, drag a chat onto a folder, onto **Pinned**, or among
  the pinned. Every drag has a menu equivalent (**Pin**, **Move to**), so a
  keyboard and a screen reader can do the same.
- **Swipe:** on a phone, swipe a row to the right to pin it and to the left to
  archive it, with Undo.
- **Menus:** right-click or long-press a row for the same menu as **⋯**.
- **Rename:** double-click a title.
- **Keyboard:** ⌥↑ and ⌥↓ go to the chat above or below in the list.

### 5. Tidying, offered, never done for you

When eight or more chats haven't moved in 30 days, a quiet card at the end of
the list offers to archive them together. It counts only chats that aren't
pinned, filed, working, waiting or new. **Archive them** comes with Undo, and
**Not now** hides the card until there are ten more. Nothing is archived
without that press. Archived chats stay searchable (ADR 0059).

### 6. A filter

A small menu beside the list's heading shows **All chats**, **New** (new or
waiting for you) or **From chat apps** (shown only when there are any). The
list stays arranged as above, with the empty groups gone.

### 7. Data

- `ConversationSummary` gains `pinned` (its place among the pinned), `folderId`
  and `seenAt`. Older versions ignore them. Archiving unpins a chat but keeps
  its folder, so unarchiving puts it back where it was.
- Folders live in `conversations/folders.json` (`ChatFolders`, `kept` in
  backups with the chats). Which folder a chat is in is stored with the chat,
  so a damaged folders file loses names, never chats. It's set aside and
  started again like every other store. A chat whose folder has gone shows by
  date. Removing a folder puts its chats back in the list.
- `folders.changed` carries every folder to every window.

### 8. ⌘K

⌘K finds folders by name and opens them in the sidebar. It also offers **Pin
this chat**, **Move this chat to…** for each folder, and **New folder**.
**Recent** in ⌘K now leaves out routine runs and tasks, as the sidebar does.

## Consequences

- The sidebar has more on it. Each extra part shows only once you use it:
  the dock with a pinned page, Needs you with a waiting chat, Pinned with a
  pinned chat, Folders with a folder. A new person sees the list they saw
  before, with month groups.
- Unread costs one PATCH when a reply lands in the chat you're reading. It's
  skipped while the window is hidden, so a chat that finished in a background
  tab stays new.
- Smart folders, folders inside folders, and folders that carry instructions
  are left out on purpose. If people ask for a folder that changes how the
  assistant answers, that's a project, and a separate decision.
