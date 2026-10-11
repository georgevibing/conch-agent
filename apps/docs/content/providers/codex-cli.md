---
provider: codex-cli
---

## Connect your ChatGPT subscription

1. Open **Settings → Providers → Codex**. If needed, choose **Install** or **Update**.
2. Choose **Sign in with your ChatGPT subscription**. No API key is needed.
3. Choose **Copy code and open sign-in page**. This works when Conch runs on another computer, too.
4. Paste the code, sign in and approve. Conch notices by itself.

Your plan decides the models and limits, and OpenAI decides each request. Setup makes no paid request.

Conch keeps its own encrypted sign-in. Your other Codex and OpenClaw sign-ins are untouched. Codex renews the connection by itself. If access ends, **Settings → Providers** offers to reconnect. **Disconnect** removes only Conch's connection.

## Conch's tools

Codex uses Conch's file tools, commands, memory, browser, skills, routines and apps, with its approvals, skill limits and **Undo**.

- **Ask first:** reads go ahead. File changes and commands ask.
- **Read only:** file reads only.
- **Auto:** everything goes ahead, except [something serious](../reference/modes.md#auto).
- **Full trust:** nothing asks but [the few things no mode lifts](../reference/modes.md#full-trust).

## Sealed commands

Sealed commands have no network and write only to the chat's work folder. One that needs more, like cloning a repository, asks first. In Full trust it doesn't ask, and in Auto not until the chat reads something.

- **On Linux,** sealing needs bubblewrap. The installer offers it, and **Settings → Health → Seal commands** types the command into Conch's terminal. On Ubuntu 23.10 and later, the same command allows it.
- **In a container** it often can't be allowed.
- **On Windows,** and until sealing works, every command runs with your access and asks first.

File tools refuse links outside the work folder, hard links and places where credentials live.

## Chats and versions

Codex 0.159.0 or newer is needed. An older one stops with an update or reconnect button, rather than dropping tools or approvals.

A chat carries on in the same Codex thread, so Codex remembers what its tools found. The thread is kept from the assistant's tools and from backups, and deleted with the chat.

When the chat's tools change, the next message starts a new thread with the whole conversation. Conch does the same when a thread can't be picked up, and notes it under **Settings → Health → Fixed on its own**.

**Stop** ends the request and the Codex program running it.
