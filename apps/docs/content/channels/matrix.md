---
channel: matrix
---

## Connect it

Your assistant gets a Matrix account of its own, and you message it from yours. Open **Apps → Talk to me here → Matrix**.

1. **Make an account for your assistant.** In Element (free), make one with the username and display name Conch suggests and a strong password of its own. Use your homeserver if you can.
2. **Sign Conch in.** Type the homeserver (leave `matrix.org` for matrix.org), the username and the password, and press **Sign in**. Conch keeps only its new "Conch" session, never the password.
3. **Say hello.** In Element, start a direct message with your assistant's account and send it anything. Conch asks **Is this you?**. Press **That's me**.

<!-- conch:channel-scene matrix key -->

## Encrypted chats work

Conch has its own encryption keys, like a new phone. It reads only messages from sessions your account has verified, so nobody can add a session in your name and give it orders.

A message from an unverified session isn't read, and the assistant says so. Verify the session in Element under **Settings → Sessions**.

## Your first hello

<!-- conch:channel-scene matrix hello -->

## Good to know

- **Approvals come with reactions.** Tap ✅ to allow, ♾️ for always in this chat, or ❌ not to. Or reply with the number.
- **An access token instead?** Use one made for Conch only. Conch refuses one of Element's own, which would break Element's encryption.
- **Groups are declined**, with a note saying why.
- **Pictures and files from Conch** arrive in the chat, up to 30 MB each, encrypted in an encrypted chat before they leave your computer.
- **Messages sent while Conch was off** are answered when it's back, for a day.
