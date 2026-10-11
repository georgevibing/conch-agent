---
channel: signal
---

## Connect it

Signal has no bots, so Conch joins **your own Signal** as a linked device, like Signal Desktop. It uses signal-cli, which Conch installs if needed: with Homebrew on a Mac or Linux, and on Windows from signal-cli's download, with Java.

Open **Apps → Talk to me here → Signal**. A code is on the page at once.

1. **Open Signal** on your phone.
2. Tap your picture, then **Linked devices**.
3. Tap **Link a new device**, and point the phone at the code in Conch.

<!-- conch:channel-scene signal link -->

Scanning it is your hello. A code nobody scans replaces itself a few times, then the page offers **Show a new code**.

## Talk to it in Note to Self

Write in **Note to Self** from any device. Your assistant answers there, and the conversation is also in Conch.

<!-- conch:channel-scene signal hello -->

To approve, reply **1** to allow, **2** for always in this chat, **3** to not allow.

## Good to know

- **Your friends' chats stay yours.** Conch never reads or answers other people's chats with you, or your groups. The exception is a number only your assistant uses, with **A number just for Conch** on.
- **signal-cli** is a long-standing open-source client that Signal doesn't make. Messages stay end-to-end encrypted.
- **Pictures and files come back** in Note to Self with their words, several in one message.
- **It keeps going by itself.** If signal-cli stops, Conch restarts it. If Java or signal-cli is missing, the channel shows **Install**, and **Repair everything** installs it too.
- **Disconnect** deletes Conch's keys from this computer. Then remove Conch under **Linked devices** on your phone. Only the phone can.
