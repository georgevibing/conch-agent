# 0027 — In your pocket: the phone's secure address, the app, notifications and voice

- Status: accepted
- Date: 2026-10-01
- Builds on: [ADR 0008](./0008-access-and-hardening.md) (reaching Conch from a phone),
  [ADR 0024](./0024-approve-new-devices.md) (devices),
  [ADR 0026](./0026-always-on.md) (Always on, the app icon),
  [ADR 0016](./0016-getting-what-a-feature-needs.md) (needs)

## Context

A phone was the weakest place to use Conch.

- **Setup.** Reaching it securely meant running `tailscale serve --bg 4317` in
  a terminal and restarting Conch. Add a device even offered the Tailscale
  address when serve wasn't on, so the QR code led nowhere.
- **No app.** There was no installable app, so a phone showed the browser's
  error page whenever Conch was out of reach.
- **No notifications.** An approval waited silently until you happened to
  look. Only Telegram could tell you anything.
- **No voice.** The microphone was blocked outright (`Permissions-Policy:
microphone=()`).

OpenClaw answers this with native iOS and Android apps (voice wake, talk mode,
push) and about 29 chat channels. Hermes uses its messaging gateway and voice
in Telegram and Discord. Conch aims for a phone experience that needs no app store,
no developer account and no terminal, with voice that can stay on your own
devices.

## Decision

### 1. A secure address in one press

`network/tailscale.ts` drives the Tailscale that's already on the computer:

- **`status()` only looks.** It runs `tailscale status --json` (missing,
  stopped, signed out, or the tailnet name), then `tailscale serve status
--json` to see whether any handler proxies to Conch's port.
- **`serve()` runs `tailscale serve --bg <port>`.** When Tailscale first needs
  an OK on its own page ("Serve is not enabled on your tailnet"), Conch keeps
  the command waiting for up to ten minutes and shows **Open Tailscale's page**.
  The address comes on by itself once the person presses Enable there.
- **Linux operator permission.** When Tailscale refuses because of it, the step
  shows `sudo tailscale set --operator=$USER` to copy.

The Host allowlist learns the name immediately (`HostPolicy.setTailscale`).
`urls()` only offers `https://<name>` once serve really reaches Conch, so a QR
code always works and no restart is needed.

Add a device shows this as a checklist when there is no https address yet:

1. Tailscale on this computer (a need, linked to its installer, because every
   Tailscale installer needs an administrator).
2. Signed in to Tailscale.
3. A secure address for Conch (**Turn on**).
4. Tailscale on your phone (App Store, Google Play).

The QR code follows by itself. The unencrypted Wi-Fi address is still there,
one press away and labelled.

"Add your phone" (⌘K, Notifications) with no sign-in yet goes to **How you sign
in** first ("Your phone signs in with a password"). Add a device then opens by
itself once a password is set.

Turning the address on needs sudo mode: it grants reach to every device on the
tailnet, though each still has to sign in.

### 2. Conch as an installed app

- **Manifest.** `manifest.webmanifest` says standalone, uses the pearl icons
  from ADR 0026 (including a maskable one) and the theme colours of both modes,
  and the page links an `apple-touch-icon`.
- **Service worker.** `sw.js` caches only `offline.html` and its script and
  icon. A page opened from the Home Screen while Conch is away shows "Conch
  can't be reached right now", with the three usual reasons. It looks again
  every five seconds and when the device comes back online, and turns back into
  Conch the moment it answers.
- **Nothing else is cached.** Chats never sit in a cache, and updates are never
  stale.
- The worker registers only in a secure context, and not on the development
  server.

### 3. Notifications (Web Push)

**Protocol.** RFC 8030 push, with RFC 8291 message encryption and RFC 8292
VAPID, composed from `node:crypto` primitives exactly as the RFCs specify:

- ECDH P-256, HKDF-SHA-256, AES-128-GCM with the `aes128gcm` coding (RFC 8188);
- ES256 JWTs with `ieee-p1363` signatures.

There is no new dependency. The test reproduces the RFC 8291 §5 worked example
byte for byte, and decrypts with an independent implementation of the
receiver's side. It was also verified for real: Chrome subscribed through FCM,
Conch sent a test, and the service worker decrypted and showed it. The push
service carries ciphertext it can't read.

**Who gets what.** A subscription belongs to its device (`device:<id>`, ADR
0024), to its session before it has a device, or to `local` when sign-in is
off. Access keys can't subscribe. A device is only told anything while it's
still allowed in: not removed, approved when approval is on, and signed in on
a live session (`AccessStore.deviceActive`). Signing out and removal end its
notifications; a lapsed one is deleted on the next send. Shutdown waits for
pending sign-out subscription cleanup before releasing the data directory.
Cleanup failures are logged; delivery still checks that the owner is allowed in.
Each device chooses its topics and whether previews show:

| Topic     | When                                                                                                      | Tap opens                              |
| --------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| approvals | `permission.requested`, a Passwords request, the browser handing over to you                              | the chat; **Deny** answers right there |
| replies   | `turn.completed` for a chat you started (not routines, not chat apps), with the first lines of the answer | the chat                               |
| routines  | a run that succeeded with something to say, or failed ("nothing to do" stays quiet)                       | the run                                |
| devices   | a new device asking to sign in (ADR 0024), sent to every device except the one asking                     | Settings → Security → Devices          |

**Quiet by design.**

- **Presence.** Every page reports whether it is visible and focused (a
  `presence` WebSocket command). Nothing is sent while a Conch page is in front
  of someone on any device. The service worker also skips showing a
  notification while one of its own pages is focused.
- **One per thing.** A notification's `tag` (and the push `Topic`) replaces the
  last one about the same thing.
- **Previews off.** The notification only says "Open Conch to see what it's
  asking".

**Deny, never Allow, from a notification.** Allowing always opens Conch,
because a lock screen is not where a command gets approved.
`POST /api/push/answer` can only ever deny (the test sends `allow` and sees a
deny), and it uses the device's own sign-in cookie.

**Security.**

- **SSRF.** A subscription's endpoint is browser-supplied, so Conch only stores
  and calls https endpoints on the push services browsers use: FCM, Mozilla,
  Apple, WNS. No credentials or other ports are allowed, and redirects are
  refused. Tests cover cloud metadata, localhost and look-alike hosts.
- **Key storage.** The VAPID key and the subscriptions (whose `auth`/`p256dh`
  let anyone push to that device) live in `push.secrets.json`, one of the
  sealed key files (ADR 0025).
- **Not backed up.** It is `derived`: a restore makes a new key, and
  `PushKeeper` quietly subscribes each device again the next time it opens
  Conch, but only where the browser had already said yes. It never asks for
  permission by itself.
- **Not under Passwords.** It is not listed in Passwords' system keys, because
  nobody manages it by hand.
- **Delivery failures.** 404/410 forget the subscription. A busy push service
  (429/5xx, `Retry-After`) is tried twice more. What's left is one sentence on
  the device in Settings → Notifications and in Repair everything.
- **A browser whose push service is off.** Brave ships with its link to
  Google's push service switched off, so `pushManager.subscribe()` fails
  (`AbortError`) even after the person said yes. Only they can change that, and
  a page can't open `brave://` settings, so the card names the switch (“Use
  Google services for push messaging”) and keeps saying it while they look,
  never the browser's own error. Verified in Brave 1.96 with a fresh profile:
  off fails, on subscribes through FCM.

**iPhone.** Web Push on iOS needs the app on the Home Screen. Notifications
says exactly that, with Safari's three taps drawn as Safari shows them
(`AddToHomeScreen`).

### 4. Voice

Hearing you, in order of privacy:

1. **On the device.** The browser's own recognition with `processLocally`
   (Chrome's on-device speech recognition: `SpeechRecognition.available` and
   `install`). Words appear as you speak.
2. **On the computer Conch runs on.** Private dictation with whisper.cpp:
   - the page records, decodes and resamples to a 16 kHz mono WAV itself, so
     no converter is needed;
   - `POST /api/voice/transcribe` writes it to a 0600 temp file, runs
     `whisper-cli -nt -np -l <code>` (the language is only ever a two-letter
     code), and deletes it;
   - at most five minutes and two at a time; the temp folder is swept on start.

   Getting it is one flow: the `whisper` need (Homebrew `whisper-cpp`), then the
   speech model `ggml-base.bin` (about 150 MB) from Hugging Face. The download
   shows progress, resumes with a `Range` request, and is checked as a whole
   against the SHA-256 Hugging Face publishes for the file (`x-linked-etag`,
   read before the redirect, over TLS).

3. **The browser's speech service.** Only after a one-time "Who hears you?",
   which names who does (Google for Chrome and Edge, Apple for Safari) and
   offers private dictation instead.

The **Automatic** setting picks the first that works here. Choices are kept per
device (`localStorage`), because microphones and voices belong to the device.

**Speaking** uses `speechSynthesis`, the device's own voices.

- It prefers the natural, enhanced or premium voice for the language.
- It speaks markdown the way a person reads it, and never reads code ("I've put
  the code on screen").
- It goes a sentence at a time, so it starts before a long answer is finished.

**Read aloud** is on every answer.

**Talk mode** (`TalkMode`, `Talk`) is a calm full screen with the pearl:

- it listens, swelling with your voice, and ends after about 1.25 s of silence;
- it sends what you said to the chat;
- it speaks the answer as it streams, then listens again.

Tap the pearl to interrupt, **Pause**, **Type instead**, or press Escape to
end. Everything stays in the chat in writing. If the assistant needs an OK, talk
pauses and says it's on screen.

`Permissions-Policy` becomes `microphone=(self)`: Conch's own page only, never
an embedded one. The microphone, like push, needs a secure context, which is
what part 1 gives a phone.

### Everything else Conch covers

- **Repair everything.**
  - The phone's address: ok when serving, off with **Set it up**.
  - Notifications: per device, when the last one didn't arrive.
  - Private dictation: a missing model is fetched again on repair.
- **Backups.** `push.secrets.json` and `voice/**` are derived.
- **⌘K.** Notifications, Add your phone, Voice.
- **Settings.** New tabs **Notifications** and **Voice**.
- **Setup.** `tailscale` and `whisper` are needs.
- **Mock engine.** The pretend Tailscale is signed in with serve off until Turn
  on. It finds no whisper, so e2e never touches a real tailnet or downloads a
  model.

## Consequences

- Phones get an app without any app store: an installed app with its own icon,
  offline screen, notifications with Deny, dictation and hands-free talk. Its
  secure address is one press, with no terminal.
- A sentence-level speech queue means talk mode answers in about the time it
  takes the first sentence to arrive.
- **Not done yet:**
  - **Telegram voice notes.** They arrive as Opus, which whisper.cpp can't read
    without a converter.
  - **A wake word.**
  - **Allow from a lock screen.** Deliberately left out.
- **Not verified on a real device yet:** iOS Home Screen push, and Chrome's
  on-device recognition. Each follows its platform's documented API and is
  covered by tests with fakes. Real push was verified in desktop Chrome.
