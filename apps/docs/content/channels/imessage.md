---
channel: imessage
---

## Connect it

iMessage works on a Mac, through the Messages app that's already there. There's nothing to make: you text yourself from your iPhone, and your assistant answers in the same chat.

In Conch, open **Apps**, choose **Talk to me here**, then **iMessage**.

1. **Let Conch read Messages.** macOS keeps your messages private, so it asks you first. Press **Open System Settings**, then turn on Conch's app under **Privacy & Security** → **Full Disk Access**. Conch names the app to turn on (Terminal, iTerm, or `node` when Conch runs in the background). The step ticks itself off when it's on.
2. **Choose how you'll text.** **I text myself** is for a Mac signed in with your own Apple ID. **This Mac has its own Apple ID** is for a Mac that people text at its own address. Conch shows the address Messages uses; nothing to type.
3. **Say hello.** Texting yourself, you're in already: Conch sends you a hello. On a Mac with its own Apple ID, text it from your iPhone, then press **That's me** in Conch.

<!-- conch:channel-scene imessage key -->

## Your first hello

<!-- conch:channel-scene imessage hello -->

## Good to know

- **Only the chat with yourself is read.** Your other conversations on the Mac are never looked at, and nobody else can write in the chat with yourself.
- **Other people's messages are never read.** It's your own account answering, so Conch never reads or answers someone else, or a group. On a Mac with its own Apple ID, **A number just for Conch** is on: people who text it get one polite reply and show up in Conch for you to **Let in** or **Block**.
- **Approvals are a number.** Messages has no buttons: when your assistant asks, the question lists its answers, and you reply with one's number (or yes, or no).
- **The first answer asks macOS once.** macOS asks whether Conch may use Messages. Press **Allow**. If you said no, the channel page says so, with **Open System Settings** (**Privacy & Security** → **Automation**).
- **Photos come as photos.** Pictures from your iPhone (HEIC) arrive as JPEG, so every provider can see them.
- **Pictures and files come back too.** A picture your assistant makes, or a file it finishes, arrives in the chat after its words. Messages sends it from a **Conch outbox** folder in your Pictures, which empties itself after a few minutes.
- **Your Mac has to be on**, with Conch running. Texts sent while it's off are answered when it's back, for up to a day.
