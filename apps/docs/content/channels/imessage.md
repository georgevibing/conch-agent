---
channel: imessage
---

## Connect it

iMessage works on a Mac, through the Messages app that's already there. There's nothing to make: you text yourself from your iPhone, and your assistant answers in the same chat.

In Conch, open **Channels** and choose **iMessage**.

1. **Let Conch read Messages.** macOS keeps your messages private, so it asks you first. Press **Open System Settings**, then turn on Conch's app under **Privacy & Security** → **Full Disk Access**. Conch names the app to turn on (Terminal, iTerm, or `node` when Conch runs in the background). The step ticks itself off when it's on.
2. **Choose how you'll text.** **I text myself** is for a Mac signed in with your own Apple ID. **This Mac has its own Apple ID** is for a Mac that people text at its own address. Conch shows the address Messages uses; nothing to type.
3. **Say hello.** Texting yourself, you're in already: Conch sends you a hello. On a Mac with its own Apple ID, text it from your iPhone, then press **That's me** in Conch.

<!-- conch:channel-scene imessage key -->

## Your first hello

<!-- conch:channel-scene imessage hello -->

## Good to know

- **Only the chat with yourself is read.** Your other conversations on the Mac are never looked at, and nobody else can write in the chat with yourself.
- **Strangers never hear back.** It's your own account answering, so Conch never replies to someone it doesn't know, or in a group. On a Mac with its own Apple ID, they show up in Conch for you to **Let in** or **Block**.
- **Approvals are a word.** Messages has no buttons: when your assistant asks, reply **yes**, **always** or **no**.
- **The first answer asks macOS once.** macOS asks whether Conch may use Messages. Press **Allow**. If you said no, the channel page says so, with **Open System Settings** (**Privacy & Security** → **Automation**).
- **Photos come as photos.** Pictures from your iPhone (HEIC) arrive as JPEG, so every provider can see them.
- **Your Mac has to be on**, with Conch running. Texts sent while it's off are answered when it's back, for up to a day.
