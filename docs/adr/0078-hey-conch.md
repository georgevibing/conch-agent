# 0078 — “Hey Conch”: a wake word that stays on your computer

- Status: accepted
- Date: 2026-10-04
- Goes with: [ADR 0077](./0077-voice-notes-and-a-natural-voice.md) (voice notes, natural voices,
  barge-in), [ADR 0027](./0027-in-your-pocket.md) (voice), [ADR 0054](./0054-the-desktop-app.md)
  (the desktop app)

## Context

Talk mode starts with a click. OpenClaw's apps answer to a spoken wake word; Conch's didn't. A wake
word means a microphone that's always open, which is exactly what a person should be able to trust
completely or not turn on at all. The bar:

- **Local.** Nothing a person says near their computer leaves it. No account, no key, no cloud.
- **Off by default**, and turned on only by the person, on the device where they want it.
- **Always visible** while it listens, with one press to stop, even with the window closed.
- **No new heavy dependency** for one feature, and nothing to train.

## The engine

| Choice                                   | Why not (or why)                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Picovoice Porcupine                      | Good and small, but proprietary: an access key from Picovoice's console, a custom phrase trained and licensed there. Not offline-free, not ours to ship.                                                                                   |
| openWakeWord                             | Open and light, but each phrase is a model trained with a synthetic-speech pipeline on a GPU. There is no “Hey Conch” model, and one per persona name is out of reach.                                                                     |
| The browser's speech recognition         | Electron has no speech service, and in Chrome it's Google's servers or a per-language on-device pack. Neither is Conch's to rely on.                                                                                                       |
| sherpa-onnx keyword spotting             | Open-vocabulary and streaming (any phrase, no training), the best fit long term, but a native addon of about 30 MB per platform in the desktop app, with Electron builds to keep in step. The upgrade path, behind the same `check`.       |
| **whisper.cpp, gated by voice activity** | **Chosen.** Already here for private listening (the `whisper` need and its model), offline, any phrase in any language, nothing to train or ship. It runs only on short bursts of speech the window has already cut out, never on silence. |

Tried on this computer: Piper saying the phrase, whisper.cpp's base model reading it. Given “Hey
Conch.” as its prompt, whisper.cpp leaves the phrase _out_ of what it writes (it takes it for what
came before), so the prompt is “Talking to an assistant called Conch:”, which heard “Hey Conch”,
“Hey Conch, what is the weather tomorrow?” and not “I found a conch shell on the beach”. A
smaller audio context (`-ac 320`) was faster but heard “Hey coach”, so it isn't used. A check takes
about two seconds on a laptop's processor, most of it loading the model; keeping it loaded
(`whisper-server`) or sherpa-onnx would bring that down.

## Decision

- **Only in the desktop app.** The gateway knows it runs there (`theApp()`); elsewhere the switch
  isn't shown and the routes refuse. Settings → Voice → **Hey Conch**: off until turned on, kept
  per device (`localStorage`, like every voice choice), so a backup can't turn it on anywhere.
  It needs private listening, and offers its setup when it isn't ready.
- **The window listens, the computer decides** (`features/voice/WakeWord.tsx`, `wake.ts`): the
  microphone with echo cancellation and noise suppression; a burst cutter (louder than the room,
  with 300 ms before it, ended by a 350 ms pause, 0.35–3.6 s of speech; talk that runs longer isn't
  a call, nor is the rest of it). Only a burst is sent, as a WAV, to `POST /api/voice/wake` on the
  same computer; one at a time, the rest dropped. whisper.cpp reads it with Conch's own prompt and
  `heardWake` looks for the phrase at the start. The recording is deleted the moment it's read;
  only “heard or not” goes back, with what came after the phrase.
- **What happens when it hears it:** the window comes to the front (`{ type: 'show' }` to the app),
  talk mode opens on the chat that's showing (or a new one), and anything said after the phrase is
  the first thing said (“Hey Conch, what's on tomorrow?”).
- **It shows, the whole time.** In the window's header, **Listening for “Hey Conch”** with **Stop**
  (Nacre `ListeningIndicator`, in words, never only a light). In the tray, shown even when the icon
  is turned off: “Listening for “Hey Conch”” and **Stop listening**, which turns it off in the
  window too (`wake.stop`). The window tells the gateway it's listening every 45 seconds; if it goes
  quiet (closed, crashed), the tray stops saying so within about a minute. The system's own
  microphone light shows too.
- **While it listens with the window closed**, the window keeps running unthrottled
  (`setBackgroundThrottling(false)`); otherwise it's throttled as before. It pauses while talk mode
  has the microphone.

## Consequences

- Conch can be called by voice in the desktop app, offline, with nothing new installed beyond
  private listening.
- Nothing about it reaches a backup, another device, or the web.
- **Not done:** the phrase follows the persona's name; a wake word on phones (a page in a mobile
  browser can't listen in the background); a faster engine (above). _The first two are done in
  [ADR 0108](./0108-the-phone-without-native-apps.md): the phrase follows the default agent's
  name, and any device listens while Conch is open and on screen on it._
