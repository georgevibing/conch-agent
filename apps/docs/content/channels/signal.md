---
channel: signal
---

## Connect it

Signal has no bots you can make, so Conch joins **your own Signal** as a linked device, the way Signal Desktop does. It talks to Signal through signal-cli, which Conch installs for you when it isn't there yet (on a Mac or Linux, with Homebrew; on Windows, Conch links to its download and installs Java for it).

In Conch, open **Apps**, choose **Talk to me here**, then **Signal**. A code is on the page at once.

1. **Open Signal** on your phone.
2. Tap your picture, then **Linked devices**.
3. Tap **Link a new device**, and point the phone at the code in Conch.

<!-- conch:channel-scene signal link -->

Scanning it is your hello: Conch knows the account is yours. A code nobody scans is replaced by itself, a few times, before the page offers **Show a new code**.

## Talk to it in Note to Self

Your assistant lives in **Note to Self**. Write there from your phone or any device; it answers there, and the conversation is also in Conch.

<!-- conch:channel-scene signal hello -->

When it asks before doing something, the question ends with numbers: reply **1** to allow, **2** for always in this chat, **3** to not allow.

## Good to know

- **Your friends' chats stay yours.** Conch never reads or answers other people's chats with you, or your groups, unless you turn on **A number just for Conch** for a number used only by your assistant.
- **signal-cli** is a long-standing open-source Signal client that Signal doesn't make. Your messages stay end-to-end encrypted; this computer becomes one of your linked devices.
- **It keeps going by itself.** If signal-cli stops, Conch starts it again. If it needs Java or signal-cli itself, the channel shows **Install**, and **Repair everything** does too.
- **Disconnect** in Conch deletes its keys from this computer. Then remove Conch under **Linked devices** in Signal as well: Signal only lets the phone do that.
