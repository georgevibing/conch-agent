# 0108 — The phone, without native apps: approve from the notification, “Hey Conch” while it’s open

- Status: accepted
- Date: 2026-10-08
- Builds on: [ADR 0027](./0027-in-your-pocket.md) (the PWA, Web Push, Deny from a notification),
  [ADR 0065](./0065-passkeys-and-approving-from-your-devices.md) (passkeys, “sudo mode”),
  [ADR 0078](./0078-hey-conch.md) (the wake word), [ADR 0100](./0100-permission-modes-every-provider.md)
  (what asks), [ADR 0101](./0101-agents.md) (the agent's name)
- Supersedes in part: ADR 0027 § “Deny, never Allow, from a notification”; ADR 0078 § “Not done”
  (the phrase and phones)

## Context

ADR 0027 keeps Conch a web app on the phone: no app store, no second codebase. Two things still sent
people back to their computer:

- **An OK.** A notification said “Pearl needs your OK” with **Review** and **Deny**. Allowing always
  opened Conch, then the chat, then a card to find and press. For a step like `npm test`, that's three
  screens for a yes. A question nobody answered waited forever in a chat someone was in.
- **“Hey Conch”** only lived in the desktop app (ADR 0078), and only ever answered to “Conch”, whatever
  the assistant was called.

What others do. Hermes Agent's approvals fail closed after 300 seconds (`approvals.timeout`), say a
timeout isn't a denial, and take yes/no as text in chat apps. OpenClaw's exec approvals bind an
**Allow Once** to the exact command, refuse a reused one, deny when no surface answers
(`askFallback: deny`), and reach its own iOS and Android apps; a late approval can't restart a closed
turn. Neither approves from a web push on a lock screen. Conch's channels already ask with buttons and
already say “⌛ No answer in time” (`channels/service.ts`), so this ADR adds nothing to them.

## Decision

### 1. Allow from the notification, only for everyday steps

`push/approve.ts` `lockScreenCheck` decides, per question, whether a lock-screen tap may allow it. It
errs to “open Conch”. A step needs the app when it:

- costs money, uses Passwords, or acts on a website;
- sends something to other people (`once`, `editable`, Gmail, Slack, an app's tool);
- was asked because the chat read something from outside (`taint`, `lasting`);
- is a plan, or anything `risk.ts` scores (credentials, remote code, wipe, privilege, publish…);
- is a command that deletes, sends, reaches another machine or runs as root, even inside the work
  folder (stricter than Auto on purpose: `OUTWARD`);
- changes a file outside the work folder, or is another app's tool (`mcp__…`), whose effect Conch can't
  read.

Everything else (a build, a test, an edit in the work folder, a web read) gets **Allow** and **Deny**.
The rest get **Review** and **Deny**. With previews off there is never **Allow**: you'd be allowing
something you can't see.

### 2. A ticket per device per question

Every notification about an OK carries its own ticket (`ApprovalTickets`):

- 32 bytes from `randomBytes`, base64url, inside the push payload, which is encrypted end to end to that
  one browser (RFC 8291). It never travels in a URL.
- Kept only as its SHA-256, in memory. A restart forgets every waiting question (they're answered “no”
  by the turn ending), so it forgets every ticket; nothing is written, nothing is backed up.
- Bound to the device's sign-in (`pushOwner`: `device:<id>`, its session, or `local`). Another device's
  cookie can't spend it.
- Good once, whatever comes of it: a wrong owner, an expired ticket, Allow on a Review question, or a
  mismatched question id all spend it. One answer spends every device's ticket for that question, and
  `permission.resolved` (answered anywhere) forgets them all.
- Good for as long as the question is, 30 minutes at most.

`POST /api/push/answer` stays behind the gateway's host, origin, Fetch-Metadata and SameSite=Strict
cookie checks; the ticket is the per-request token on top. A body without a decision is still a no, so
an older service worker keeps working. The service worker shows **Allowed**, **Denied** or **Already
answered** in place of the question, or opens the sheet when the step needs the app or Conch can't be
reached.

### 3. The approval sheet

The notification opens `/c/<id>?approve=<permission>`, and the chat shows Nacre `ApprovalSheet`: a
bottom sheet with who asks and where, what will happen as a big title, exactly what it would do (the
command, the file, the address), when no answer becomes a no, and two big buttons where a thumb rests.
Answering seals it: a ring draws itself round a check (still under reduced motion), and **Back to the
chat**. Arriving at a question already answered says so.

From the sheet, a step that matters (the same `lockScreenCheck`) is allowed only after a recent passkey
or password: the gateway answers `verify-required` unless `Gatekeeper.verified` (the 10-minute “sudo
mode”), and `useVerify` asks. The sheet says why first. The chat's own card is unchanged: it's the same
person in the same app on an unlocked device; the lock screen was the new reach, and that's what the
passkey guards. Where a browser shows no notification buttons (iPhone, Safari), a tap opens the sheet; the
service worker offers buttons only up to `Notification.maxActions` where a browser says it.

### 4. A question nobody answers is a no

In a chat someone is in, a question waits 30 minutes (`ATTENDED_PERMISSION_MS`), then resolves
`expired` with `unanswered: 30`, and the step doesn't happen. The row says **No answer in 30 minutes, so
it didn't**. Unattended runs keep their hour. Never a yes by itself (agreement 11, “Never auto-approve a
waiting permission”). The ticket's lifetime is the same constant.

### 5. “Hey Conch” on the phone, honestly

What a mobile browser allows, checked against the platforms' own documentation:

- **No background microphone.** iOS Safari and Home Screen apps stop capture when the page is hidden or
  the screen locks; Android Chrome does too for a hidden tab. No web API asks for more.
- **Foreground, screen on.** The Screen Wake Lock API (Chrome, Safari 16.4+, Home Screen apps from iOS
  18.4) keeps the screen on while it listens; without it, the screen sleeps and listening ends.
- **On-device detection** in the page would need a model per phrase (openWakeWord) or a 30 MB WASM
  spotter; ADR 0078's whisper.cpp on the computer already hears any phrase in any language.

So: any device that isn't the desktop app listens only while Conch is open and visible on it
(`WakeWord.tsx` mode `open`). It keeps the screen awake, says **Listening for “Hey Pearl”** with **Stop**
the whole time, stops by itself after 5 minutes without hearing it (**Stopped listening…** with **Listen
again**), and stops when the page is hidden, resuming when it's back. Bursts go to the gateway only from
a device that said it's listening in the last minute (`WakeWord.open`, at most eight devices), read by
whisper.cpp on the computer Conch runs on, over the secure address, and thrown away. Settings → Voice
says in words that a locked phone can't be woken.

**The phrase follows the agent's name** (ADR 0101): the default agent's, its first two words of letters
(`callable`), accents as written or not; “Hey Conch” always works. whisper.cpp's prompt names it the
same way. A name is escaped letter by letter, so it can't put a pattern in the matcher.

## Security

Threat model: someone holding a locked phone, another site in the phone's browser, another signed-in
device, a replayed or forwarded push, and the agent itself.

- A lock-screen tap can only allow what Auto would usually let through anyway; everything that matters
  needs the unlocked phone and a passkey or password (NIST SP 800-63B-4 § reauthentication for
  sensitive actions).
- CSRF: SameSite=Strict, Fetch Metadata (the gateway refuses `cross-site`), and a one-use token bound
  to the session (OWASP CSRF Prevention Cheat Sheet, OWASP Session Management Cheat Sheet). Tested in
  `push/routes.test.ts`.
- Replay, another device's ticket, a ticket for another question, an expired one, one answered
  elsewhere: `push/approve.test.ts`, `push/service.test.ts`.
- The agent can't reach any of it: tickets live only in the gateway's memory and the device's
  encrypted push; no tool answers a question.
- Nothing new on disk, so no backup rule, no doctor check, nothing in `lib/protect.ts`.

## Consequences

- An everyday OK is one tap from the lock screen; anything that matters is a sheet and a passkey.
- A forgotten question no longer holds a chat open forever.
- “Hey Conch” works on a phone while Conch is open, and answers to the assistant's name everywhere.
- **Not done:** a wake word on a locked phone (needs a native app, which ADR 0027 declines); the
  phrase following the chat's own agent rather than the default; mirroring a web chat's question to a
  chat app (channels ask for their own chats already); the in-chat card asking for a passkey on
  remote devices.
