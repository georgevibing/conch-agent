---
channel: matrix
---

## Connect it

In Conch, open **Apps**, choose **Talk to me here**, then **Matrix**. Your assistant gets a Matrix account of its own, and you message it from yours.

1. **Make an account for your assistant.** Conch suggests a username and a display name. Make the account in Element (it's free), on the same homeserver as yours if you can, and give it a strong password of its own.
2. **Sign Conch in to it.** Type the homeserver (leave `matrix.org` for matrix.org), the username and the password, and press **Sign in**. Conch signs in once, as a new session called "Conch", and keeps only that session. It never keeps the password.
3. **Say hello.** In Element, start a direct message with your assistant's account and send it anything. Conch asks **Is this you?** with your name. Press **That's me**.

<!-- conch:channel-scene matrix key -->

## Encrypted chats work

Element encrypts direct messages, and so does your assistant: Conch has its own encryption keys, like a new phone. It reads only messages from sessions your account has verified, so nobody can slip in a session in your name and give it orders.

If a session of yours isn't verified, the assistant says so in the chat and doesn't read the message. Verify it in Element under **Settings** → **Sessions**.

## Your first hello

<!-- conch:channel-scene matrix hello -->

## Good to know

- **No public address.** Conch keeps asking the homeserver for news from your computer, so nothing is opened to the internet.
- **Approvals come with reactions.** Tap ✅ to allow, ♾️ for always in this chat, or ❌ not to. Replying with the number works too.
- **An access token instead?** Use one made for Conch only. One of Element's own would break Element's encryption, and Conch refuses it.
- **Groups are declined**, with a note saying why.
- **Pictures and files from Conch** (a picture it made, a file it finished) arrive in the chat, up to 50 MB each. In an encrypted chat they're encrypted before they leave your computer.
- **Messages sent while Conch was off** are answered when it's back, for a day.
