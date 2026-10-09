# 0124 — Drafts that follow you, with their files

- Status: accepted
- Date: 2026-10-09
- Builds on: [ADR 0017](./0017-attachments.md) (attachments),
  [ADR 0089](./0089-the-chat-list-organised.md) (the chat list),
  [ADR 0020](./0020-backups.md) (backups)

## Context

What you were writing in a chat was kept in the browser's `localStorage`, words only. Attached
files and pictures were lost as soon as you went to another chat, and so was everything on a new
browser, on your phone, or after signing out here. An unsent upload belongs to nobody and is
swept after a day, so even a remembered id would have pointed at nothing by the next morning.
The new chat page's model and mode, chosen before the first message, were lost on a reload.

Slack, Messages and Gmail all keep a draft per conversation, follow you between devices, and mark
the conversation **Draft** in the list.

## Decision

**One draft per chat, and one for the new chat page, kept by the gateway.** `PUT
/api/conversations/:id/draft` keeps it as it is now; `GET` reads it back; `:id` is the chat, or
`new` for the new chat page. `GET /api/drafts` lists which chats have one, for the list's mark.
Bodies and answers are `@conch/protocol` schemas (`PutDraftBody`, `DraftReply`, `DraftList`),
validated on both sides. The store is `conversations/drafts.json` (`drafts/store.ts`), healed on
read like the folders beside it, and kept in backups with the chats.

**A draft is words, attachment ids and a new chat's choices.** Long pastes are already
attachments (`pasted`), so they come along. The gateway looks each id up itself rather than
trusting what the browser describes, drops the ones it no longer has, and names them in
`missing`. A chat's own model and mode are kept with the chat already; only the new chat page's
choices are part of its draft. Conch has no quoted replies, so there is nothing more to keep.

**A draft holds its files.** The attachment sweep asks the drafts which ids they hold
(`AttachmentStore` `drafted`) and leaves those alone however old they are. If the drafts can't
be read, the sweep removes nothing that round: a file someone is about to send is worth more than
a day's tidiness.

**Letting go.**

- Sending clears it: the composer empties, and the empty draft goes at once, not after the pause.
- Deleting a chat removes its draft, and discards the uploads only that draft held.
- A draft untouched for 30 days is let go at the next sweep, and its files go with it like any
  upload that was never sent.
- A `PUT` for a chat that no longer exists is refused, so a stale tab can't bring a deleted
  chat's draft back.

**The browser keeps a copy, and Conch's wins unless this copy is newer.** The box fills from
this device's copy in the first frame (words and cards), then asks Conch. Each copy here records
whether Conch has it (`synced`). If it does, Conch's copy is taken, so what you wrote on the phone
shows on the laptop. If it doesn't (written offline, or before an older Conch kept drafts), this
copy is sent instead. This avoids comparing clocks across devices. Changes go to Conch once
typing pauses (700 ms), at once when the draft becomes empty, and with `keepalive` as the page
hides or closes. Coming back to the tab, or back online, sends what's waiting or takes what was
written elsewhere. Signing out here still clears this device's copy; Conch's stays for your
next sign-in.

**The chat list says Draft in words.** Nacre `ChatRow` `draft` shows a muted pencil and the word
**Draft** after the title, never a colour alone. It isn't shown on the open chat, where the box
shows the draft itself.

**A file that was let go says so.** Nacre `AttachmentCard` `status="lost"` shows **No longer
here**, dims what it was, and keeps its remove button showing. Sending is held until it comes off,
so a message never goes without something the person saw attached.

## Consequences

- A draft follows you through a reload, closing the tab, a gateway restart, another browser and
  the phone. It moves between devices when a chat opens or the tab comes back into view, not
  live while both are open. Live sync would need a socket message per pause, and nobody types the
  same draft on two devices at once.
- Two devices editing the same draft offline: whichever sends last wins. Drafts are small and
  personal, so merging isn't worth it.
- An upload still in progress when the page closes is lost (its bytes were only in the tab).
  Everything that had finished uploading is kept.
- There is no "clear the box" command, so there is no undo for one. A card removed by hand is
  discarded at once, as before.
