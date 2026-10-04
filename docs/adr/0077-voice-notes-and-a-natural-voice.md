# 0077 — Voice notes, a natural voice, and talking over it

- Status: accepted
- Date: 2026-10-04
- Goes with: [ADR 0027](./0027-in-your-pocket.md) (voice on your devices), [ADR 0018](./0018-channels.md)
  (channels), [ADR 0016](./0016-getting-what-a-feature-needs.md) (needs), [ADR 0017](./0017-attachments.md)
  (attachments)

## Context

ADR 0027 gave Conch ears and a voice in the browser: Chrome's on-device recognition, then
whisper.cpp on the computer Conch runs on, then the browser's own service; and the device's
`speechSynthesis` to speak. It left three gaps, and comparing Conch with OpenClaw and Hermes
showed them plainly:

- **Voice notes from chat apps were stored and never heard.** A Telegram, WhatsApp or Signal
  voice note became an audio attachment the assistant couldn't open. `transcribe` was only ever
  called from the dictation route. ADR 0027 named the reason: they arrive as Opus (or AAC, or
  AMR), which whisper.cpp can't read.
- **whisper.cpp couldn't be had on Windows.** No package manager there carries it, so the need
  was a link to a GitHub page: a dead end for anyone who doesn't unzip programs.
- **The voice was the device's.** `speechSynthesis` ranges from good (macOS's premium voices) to
  robotic (most Windows and Linux voices), and talk mode could only be interrupted by a tap.
- **No wake word.** Talk mode starts with a click; ADR 0078 adds one to the desktop app.

## Decision

### 1. Voice notes are heard on this computer, on every channel that has them

- **The app says what's a voice note.** Each adapter marks the recording a person made in the
  chat (`ChannelFile.voice`): Telegram's `voice`, WhatsApp's `ptt`, Signal's `isVoiceNote`,
  Discord's `IS_VOICE_MESSAGE`, Slack's `slack_audio` clips, Matrix's MSC3245 `voice`, iMessage's
  `.caf` audio messages, and a WeChat Official Account's voice without its own recognition.
  An audio _file_ someone shares is left as a file. `VOICE_NOTE_CHANNELS` (protocol) lists them.
- **One shared path.** The channel service hears a voice note before the message goes on
  (`VoiceService.transcribeNote`): FFmpeg turns it into the 16 kHz WAV whisper.cpp reads
  (`voice/audio.ts`), and whisper.cpp reads at most its first ten minutes. It works offline.
- **A voice note is only ever audio to FFmpeg.** It's a stranger's bytes, and FFmpeg can do much
  more than decode: an HLS playlist, a concat list or a `subfile:` URL makes it read other files
  (Conch's keys) into its output. So Conch sniffs the first bytes itself and accepts only real
  audio containers (Ogg, WAV, MP4/M4A/3GP, CAF, AMR, MP3, ADTS AAC, Matroska/WebM, FLAC); FFmpeg is
  told that demuxer (`-f`), never probes, may open no other (`-format_whitelist`), and gets the
  bytes on stdin and gives the WAV on stdout with `-protocol_whitelist pipe`: no file protocol
  exists for anything inside to reach, and nothing touches the disk. `audio.test.ts` throws
  playlists, concat lists, polyglots (Ogg's magic with a playlist after it) and oversized files at
  it, against the real FFmpeg where there is one.
- **Caps on what really arrives.** A voice note's download is counted as it arrives and stopped
  past 20 MB, whatever size the app declared (`readCapped`, every adapter's `download`). At most
  three voice notes from one person and eight in all are heard at once (beyond that the sender
  is asked to send it again), whisper.cpp runs two at a time with at most sixteen waiting, and
  FFmpeg is killed past its time or its output's size.
- **The words are the message.** The assistant gets what was said as the message's text, like
  anything typed, so every provider works the same. The recording stays attached, with its
  words (`Attachment.transcript`), so Conch shows the voice note and what it said together;
  `forTurn` tells every engine its words are the message, so no model tries to open the audio.
- **Only people let in are heard.** A stranger's voice note is never transcribed: it waits behind
  a request like any message.
- **Spoken words aren't typed words.** A recording can carry anyone's voice (a forwarded note, a
  video playing nearby), so the chat reads a voice note's words like someone else's, even the
  owner's ("a voice note on Telegram", ADR 0028): anything risky after it asks first. Someone
  else you let in is labelled as their typed words are.

### 2. Nothing is lost while Conch can't hear yet

When Conch can't hear a voice note, it heals what it can and keeps the rest waiting:

- **The note waits** in the channel (`StoredChannel.voiceWaiting`, at most 30, oldest dropped
  first, and none longer than a week), its recording kept as a `held` attachment the sweep keeps
  for eight days instead of one. Nothing else is kept: FFmpeg works in memory, whisper.cpp's one
  file in `voice/tmp` goes whatever happens, and anything a crash left there is swept on start and
  whenever another recording is read.
- **The sender is told once**, in plain words: "give me a minute" when Conch is fixing it
  itself, or "turn them on in Conch, or type it for me" when a program is missing.
- **A missing speech model is fetched again at once**, and noted under **Fixed on its own**.
- **A missing program is a need** (whisper.cpp, FFmpeg) with one **Get it** on the channel's page,
  which carries straight on to FFmpeg and the speech model from the same press.
- **It carries on by itself.** When a need lands (`Services.needLanded` → `recheckNeeding`) or the
  model finishes (`voice.changed` ready), every waiting note is heard and goes to the assistant in
  order, as if it had just arrived. A restart hears them too.

### 3. Programs Conch fetches itself, and Python programs through uv

Two new kinds of install recipe join winget, Homebrew and npm (ADR 0016):

- **`github`**: Conch fetches a project's own release (`setup/release.ts`), for the few programs
  no package manager here carries: whisper.cpp on Windows and on Linux without Homebrew, and uv
  on Linux (whose installer is a script piped into a shell, which Conch never runs). Only a
  finished release with a version for a tag; only GitHub's download address for that very
  repository; hashed as it arrives and thrown away unless it matches the SHA-256 GitHub publishes
  for the file (a file without one is never used); unpacked by the system's own `tar`, which
  refuses paths that climb out; into `CONCH_HOME/tools/<need>/<tag>`, with the old version removed
  only once the new one works. Updates follow the same releases (`LatestLookup.github`).
- **`uv`**: a Python program installed as a uv tool of its own (`uv tool install piper-tts`), with
  the Python it needs, for this user only; updated with `uv tool upgrade`, its newest version read
  from PyPI. Its recipe says `via: 'uv'`: when uv isn't here yet, the same press installs uv
  first. The command shown before the press says both steps.

`tools/` and `voice/` are protected from the assistant's own file tools (`lib/protect.ts`): Conch
runs what's there. Both are `derived` in backups: fetched again on a new computer.

### 4. A natural voice, on this computer

- **Piper**, the neural voices Home Assistant maintains (`piper-tts`, GPL, run as a program of its
  own), installed by uv as a need with version, latest (PyPI) and update. Kokoro sounds a little
  better, but it has no maintained command-line program, and its JavaScript route needs
  espeak-ng compiled in (GPL) and a second copy of transformers.js; Piper installs the same way on
  Windows, macOS and Linux with wheels for each, and runs offline.
- **A few good voices, pinned**: one or two for each language Settings → Voice offers, each two
  files from `rhasspy/piper-voices` at one revision, with sizes and SHA-256s in the code
  (`speech.ts`), checked as they download and again by Repair everything.
- **Kept running.** Starting Piper costs a second or two; a sentence once it's up, a tenth of
  that. One small process (`piper.ts`) runs Piper's own Python with a fixed script and none of
  Conch's environment, takes a line of JSON per sentence on stdin, and stops after five quiet
  minutes. Without that Python, `piper` runs once per sentence instead.
- **A provider's voice, only when chosen.** With an OpenAI key saved, OpenAI's voices are offered
  too, saying that what's read aloud goes to OpenAI. Nothing else connects to a cloud voice, and
  ElevenLabs isn't offered: Conch has no ElevenLabs connection to reuse.
- **In the browser**, Conch's voices play a sentence or two at a time from `/api/voice/speak`
  (the next fetched while one plays) through the page's own audio. If one can't speak, the device's
  voice reads the rest and the page says why once. `speechSynthesis` stays the fallback.
- **Voice notes back.** Each channel's **Answer with a voice note**: when you send one (the
  default), always, or never; the answer is written either way. The reply voice is the natural
  voice chosen in Settings → Voice (`preferences.voice`), else the first one here. FFmpeg makes it
  Opus in Ogg (Telegram, WhatsApp, Discord) or AAC (Signal), and Conch's own notes are never heard
  back (WhatsApp's chosen ids, Signal's sent timestamps and mark).

### 5. Talking over it: barge-in

Talk mode no longer needs a tap to interrupt. While the assistant speaks, the microphone stays open
with the browser's echo cancellation, noise suppression and gain control (`vad.ts`), and a small
voice-activity detector (`SpeechGate`) decides when a person has started talking:

- **The voice band only** (250 Hz – 3.8 kHz), against **the room** (the quietest it's been lately,
  rising slowly) and against **its own leak**: its first 300 ms of speech teach the gate how loud
  what comes back from the speakers is, and a person must be clearly louder (2.2×). A device voice
  the browser can't cancel leaks more, and the gate learns that too.
- **Long enough to be a word**: a quarter of a second, dips allowed; a click or a cough doesn't count.
- Then it stops speaking, drops the rest of the answer and listens, exactly as a tap does. Conch's
  own voices play through the page, which echo cancellation hears best; that's the reason they do.

The same code runs in the desktop app's window. With no microphone while it speaks, the pearl
still interrupts, and the line under it says which works.

## Consequences

- A voice note in any chat app the person uses becomes words on their own computer, offline,
  and their assistant answers it like anything they typed.
- whisper.cpp, and so private dictation, is one press on Windows too.
- Every channel's page says how many voice notes wait and what one press gets.
- Answers can be read with a natural voice on every computer, offline, and voice notes are
  answered the way they were sent.
- Talk mode is a conversation: talking over the assistant interrupts it.
- **Not done here:** hearing voice notes through a cloud service. Conch hears on this computer
  or not at all; a person who'd rather not install anything types instead.
