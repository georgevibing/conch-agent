---
title: Voice
description: Talk to your assistant, hear it answer, and send it voice notes from your chat apps. Your voice can stay on your own computer.
order: 6.5
---

## Speak instead of typing

Press the microphone in the message box and talk. Conch hears you the most private way your device allows:

1. **On the device itself.** Chrome hears you on your computer or phone, with words appearing as you speak.
2. **On the computer Conch runs on.** whisper.cpp hears you there, even when you speak into your phone. It works offline.
3. **Your browser's speech service.** Only after you say yes. It sends your words to Google (Chrome, Edge) or Apple (Safari).

Choose one in **Settings → Voice → How Conch hears you**. For the private way, press **Get it**: Conch installs whisper.cpp and its speech model (about 150 MB, once).

## Hear the answers

Every answer has **Read aloud**. Conch reads it as a person would, skipping symbols and code ("I've put the code on screen"), and starts before a long answer is finished.

### A natural voice

1. Open **Settings → Voice → How Conch sounds** and press **Install Piper**.
2. Press **Get it** beside a voice (about 60 MB, once). There are one or two per language.
3. Press play to hear it, and **Use** to choose it.

These voices run on the computer Conch runs on, offline. With an OpenAI key, OpenAI's voices are listed too; what's read then goes to OpenAI and is billed there. If a natural voice fails for a moment, your device's voice reads the rest, and Conch says why.

## Talk, hands free

While the message box is empty, its round button is **Talk**. It opens a calm full screen with the pearl. Speak, pause, and it goes to your assistant. The answer is spoken as it arrives, then Conch listens again. Everything stays in the chat in writing.

To interrupt, start talking: Conch stops and listens. Its own voice, a cough or a click don't count. Tapping the pearl, **Pause** and **Type instead** work too.

## “Hey Conch”

Say **“Hey Conch”**, or your assistant's own name (**“Hey Pearl”**), to start talking without touching anything. Say what you want in the same breath ("Hey Pearl, what's on tomorrow?") and it goes straight to your assistant.

Turn it on in **Settings → Voice → Hey Conch**, on each device. It needs whisper.cpp and its speech model on the computer Conch runs on, and Conch offers to get them.

- **In the desktop app**, it listens even with the window closed, and Conch comes to the front when you call.
- **On a phone or in a browser**, it listens only while Conch is open and on screen. It keeps the screen on, and stops after 5 minutes without hearing it; **Listen again** restarts it. It can't wake a locked phone, which would need an app-store app Conch doesn't have.

While it's on:

- **It stays on your computers.** Short bursts of speech are checked on the computer Conch runs on, over your secure address, and thrown away. Nothing is recorded or sent anywhere else.
- **You can always tell.** **Listening for “Hey Conch”** shows at the top of the window, or in the tray (menu bar) with the window closed, with **Stop**. Your microphone light is on too.
- It pauses while you're talking to Conch.

## Voice notes from your chat apps

Send a voice note on Telegram, WhatsApp, Signal, Discord, Slack, Matrix, iMessage, WeChat, Feishu / Lark, DingTalk or QQ, and your assistant answers as if you'd typed it.

- whisper.cpp hears it on the computer Conch runs on, offline, so it goes to no one else.
- In Conch, the chat shows the note with its words.
- Up to ten minutes is heard. Of a longer note, Conch tells you it heard the first ten.

To turn it on, open the app in **Apps → Talk to me here**, press **Turn on**, then **Get it**. That installs whisper.cpp, FFmpeg and the speech model.

A note that arrives before then waits. The app's page says how many, you get one message about it, and Conch answers them in order once it can hear.

- Only people you let in are heard. Anyone else's note waits behind their request.
- A recording can carry anyone's voice, so after one, your assistant asks before anything risky.

### Answered with a voice note

On Telegram, WhatsApp, Signal and Discord, your assistant answers a voice note with one, in your chosen voice, and in writing. Change it with **Answer with a voice note** on the app's page: **When you send one**, **Always** or **Never**.
