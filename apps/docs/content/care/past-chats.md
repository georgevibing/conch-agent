---
title: Your past chats from other apps
description: Bring the conversations you had in Claude Code, Codex, Gemini CLI and others into Conch, to search, read and carry on.
order: 7.5
nav: Past chats
---

If you've talked to Claude Code, Codex, Gemini CLI, OpenCode, Copilot in VS Code, OpenClaw or Hermes on this computer, Conch finds those conversations by itself. With one press they come into Conch as past chats: you can find them with <kbd>mod+k</kbd>, your assistant can look through them when you mention one, and any of them can be carried on here. Those apps are only read, never changed.

## Bring them in

When Conch finds some, a new chat offers them in one short tip under the box, such as **Bring in 1,284 past chats** (point at it to see the apps). It shows when no [tip before it](../start/first-chat.md#what-the-new-chat-offers-next) is waiting, and its **×** puts it away for good. It opens **Settings → What Conch knows → Your past chats**: **Found 1,284 conversations**, with how many came from each app and the projects they were about. The offer lives there afterwards as well, and <kbd>mod+k</kbd> finds it ("past chats", "Claude Code").

1. Press **Bring them in**. There's nothing to choose and no folder to find.
2. Watch them come in: the bar says how many so far, and which app it's reading. You can keep using Conch meanwhile.
3. When they're in, it says so, with how many things that looked like a key or a password were taken out. Press **Search them** to try it.

Once you've brought chats in, new ones from the same apps come in by themselves, a few times a day. Only what's new, or what has grown since, is read again.

## What comes in

- What you said, and what the assistant answered. Not the steps it took (the commands, the files it read, what came back from them), nor its thinking.
- The chat's title, the project it was about, when it happened, and the model that answered, when the app kept them.
- Nothing that looks like a key, a token or a password. Those are replaced with •••, and so is every password Conch's [Passwords](../features/passwords.md) knows.
- Not the chats Conch itself had with Claude Code, which are already here, nor a helper's own conversation, a routine's run or a group chat.

## Find and read them

Past chats aren't in the chat list, so it stays yours. They're found everywhere else:

- **<kbd>mod+k</kbd>** finds any line in them, like any chat. Choosing one opens it beside where you are, to read. See [Find anything](../features/find.md).
- **Your assistant** finds them when you mention something from before: "what did we decide about the checkout bug in Claude Code?". It treats what they say as information, never as instructions, and anything risky it does next asks first, as after reading a web page. See [Memory](../features/memory.md#your-earlier-chats).
- Nothing in them is learned as a memory: they're read when asked, and remembered only if you say so.

## Carry one on

A past chat opens with **Carry on here**. Press it, and a new chat starts in Conch with that conversation in it. Whoever answers next is given the conversation so far: Claude Code for a chat from Claude Code, Codex for one from Codex, Gemini CLI for one from Gemini CLI, when they're connected, and your usual model otherwise. The chat in the other app stays as it was.

## Take them out

**Settings → What Conch knows → Your past chats → Take them out** removes every past chat from Conch, after asking. The apps they came from keep theirs, and the chats you carried on here stay. You can bring them in again any time. It may ask you to confirm it's you.

## Good to know

- Conch looks where each app keeps its chats: `~/.claude`, `~/.codex`, `~/.gemini`, OpenCode's folder in `~/.local/share`, VS Code's settings folder, `~/.openclaw` and `~/.hermes`. If you moved one with its own setting (such as `CLAUDE_CONFIG_DIR` or `CODEX_HOME`), Conch looks there.
- Links inside those folders aren't followed, and their databases are opened read-only.
- A file Conch can't read (damaged, or a shape it hasn't seen yet) is skipped and counted. Everything else still comes.
- Cursor keeps its chats in a database of its own, which Conch doesn't read yet.
- Past chats are in your [backups](./backups.md), with your chats.
