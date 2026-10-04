---
provider: codex-cli
---

## Connect your ChatGPT subscription

1. Open **Settings → Providers → Codex**. If needed, choose **Install** or **Update**.
2. Choose **Sign in with your ChatGPT subscription**. You do not need an API key.
3. Conch shows a short code. Choose **Copy code and open sign-in page**: the code is copied, and the page opens in a new tab. This works when Conch runs on a remote computer, too.
4. Paste the code there, sign in to your own ChatGPT account and approve the connection. Conch notices by itself and verifies the account before reporting it connected.

Your plan and workspace determine available models and usage limits. A model appearing in the list is not a guarantee that a particular request is included in your plan; OpenAI confirms that when it handles the request. Conch does not make a paid test request during setup.

Conch keeps a **separate encrypted sign-in**, not a copy of your credentials from another assistant. Existing Codex/OpenClaw sign-ins are untouched. The Codex app-server renews this connection automatically. If access expires or is revoked, **Settings → Providers** offers reconnecting. Choose **Disconnect** to remove only Conch’s connection.

## The same Conch tools

Codex can use Conch’s memory, browser, skills, routines and connected apps. Conch supplies work-folder file tools and safe commands, validates tool arguments, and applies its approvals, skill limits, read-then-act checks and Undo tracking before changes.

- **Ask first:** reads are available; file changes and commands ask.
- **Plan only:** file reads only; changes and commands are refused.
- **Edit freely:** work-folder file edits need no extra question; commands ask.
- **Full trust:** ordinary work-folder actions need no extra question. Protected paths, disabled tools and read-then-act checks still apply.

Commands run in an operating-system sandbox where this computer can make one: no network access, and writes limited to this chat’s work folder. A command that needs more, like cloning a repository or installing something, asks to run with your access first (in Full trust it just runs). On Linux, sealing needs bubblewrap, a small sandbox program: the installer offers it, and **Settings → Health** has **Seal commands**, which types the one command into Conch's terminal for you. Until then, and on Windows, every command runs with your access and asks the same way. File tools reject links outside the workspace, hard links and protected credential locations.

## Conversations and compatibility

Conch uses Codex’s supported app-server interface, not `codex exec`. Codex 0.159.0 or newer is required. Dynamic tool definitions are an experimental app-server surface; unsupported versions fail with an update/reconnect action rather than silently dropping tools or approvals.

A chat carries on in the same Codex thread from one message to the next, so Codex remembers what it did and what its tools found, not only what was said. Conch keeps the thread between messages, out of reach of the assistant’s own tools and out of backups, and deletes it with the chat.

When the chat’s tools change (you connect or remove an app, or turn a tool off), the next message starts a new thread with the whole conversation, so Codex never sees a tool that’s gone. If a thread can’t be picked up again, Conch does the same by itself and notes it under **Settings → Health → Fixed on its own**.

For credential-refresh safety, turns on this Codex connection run one at a time. Other providers can still run concurrently. Cancel stops the active request and its child process.

The computer must also let bubblewrap make its sandbox. Ubuntu 23.10 and later restrict that until it's allowed, and the same command allows it. A container often can't allow it at all; then commands run with your access and ask first.
