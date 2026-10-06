---
title: Voice
description: Talk to your assistant, hear it answer, and send it voice notes from your chat apps. Your voice can stay on your own computer.
order: 6.5
---

## Speak instead of typing

Press the microphone in the message box and talk. Conch hears you in the most private way your device has:

1. **On the device itself.** Chrome hears you on your computer or phone, and the words appear as you speak.
2. **On the computer Conch runs on.** whisper.cpp turns what you say into words there, even when you're speaking into your phone. It works offline.
3. **Your browser's speech service.** Only after you say yes: it sends what you say to Google (Chrome, Edge) or Apple (Safari).

Conch picks the most private way it can. To choose one yourself, open **Settings → Voice → Advanced → Where your voice is heard**. To set up the private way, press **Get it**: Conch installs whisper.cpp and downloads its speech model (about 150 MB, once), with nothing else to do.

## Hear the answers

Every answer has **Read aloud**. Conch reads it the way a person would: no symbols, no code ("I've put the code on screen"), and it starts before a long answer is finished.

### A natural voice

Your device's own voices can sound robotic. In **Settings → Voice → How Conch sounds**, press **Install Piper**, then **Get it** beside a voice (about 60 MB, once). These natural voices run on the computer Conch runs on and work offline. Press the play button to hear one, and **Use** to choose it. There are one or two for each language.

If you've added an OpenAI key, OpenAI's voices are in the list too. What's read aloud then goes to OpenAI, and counts toward what you pay there.

If a natural voice can't speak for a moment, your device's own voice reads the rest, and Conch tells you why.

## Talk, hands free

While the message box is empty, its round button is **Talk**, ringed in pearl light; as soon as you type, it turns into Send. **Talk** is a calm full screen with the pearl. Say something, and when you pause, it goes to your assistant; the answer is spoken as it arrives, then Conch listens again. Everything stays in the chat in writing.

To interrupt, just start talking: Conch stops, drops the rest of its answer and listens. It cancels its own voice from what the microphone hears, so it doesn't interrupt itself, and a cough or a click doesn't count. Tapping the pearl works too, and so do **Pause** and **Type instead**.

## “Hey Conch”

In the desktop app, you can start talking without touching anything: say **“Hey Conch”**. Conch comes to the front and listens; say what you want in the same breath (“Hey Conch, what's on tomorrow?”) and it goes straight to your assistant.

It's off until you turn it on, in **Settings → Voice → Hey Conch**, on that computer only. It uses private listening, so it needs whisper.cpp and its speech model (Conch offers to get them).

While it's on:

- **It stays on your computer.** The microphone listens for short bursts of speech, and each one is checked on your computer and thrown away. Nothing is recorded, kept or sent anywhere.
- **You can always tell.** **Listening for “Hey Conch”** shows at the top of the window, and in the tray (or menu bar) even with the window closed, each with **Stop**. Your computer's own microphone light is on too.
- It pauses while you're talking to Conch.

## Voice notes from your chat apps

Send your assistant a voice note on Telegram, WhatsApp, Signal, Discord, Slack, Matrix, iMessage or WeChat, and it answers as if you'd typed it.

- **Heard on your computer.** whisper.cpp turns the voice note into words on the computer Conch runs on, so it never goes to anyone else. It works offline.
- **You see what it heard.** In Conch, the chat shows the voice note with its words.
- **The first ten minutes** of a long one are heard, and Conch tells you so.

Voice notes need three things on your computer: whisper.cpp, FFmpeg (which reads the recordings chat apps send) and the speech model. Open the app in **Apps → Talk to me here** and press **Turn on**, then **Get it**: one press gets all three.

If a voice note arrives before that, nothing is lost. It waits, the app's page says how many are waiting, and you get one message saying so. Once Conch can hear, it answers every one that waited, in order, by itself. If only the speech model was missing, Conch gets it again on its own and asks you to give it a minute.

Only the people you let in are heard. A voice note from anyone else waits behind their request like any message.

Your assistant treats what a voice note says a little more carefully than what you type, because a recording can carry anyone's voice. After a voice note, it asks before anything risky.

### Answered with a voice note

On Telegram, WhatsApp, Signal and Discord, your assistant answers a voice note with a voice note, spoken with the natural voice you chose. The answer is written too. Change it on the app's page: **Answer with a voice note** is **When you send one**, **Always** or **Never**.
