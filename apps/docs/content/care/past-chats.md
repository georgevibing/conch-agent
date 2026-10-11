---
title: Your past chats from other apps
description: Bring the conversations you had in Claude Code, Codex, Gemini CLI and others into Conch, to search, read and carry on.
order: 7.5
nav: Past chats
---

Conch finds your conversations on this computer from Claude Code, Codex, Gemini CLI, OpenCode, Copilot in VS Code, OpenClaw and Hermes. With one press they come in as past chats: <kbd>mod+k</kbd> finds them, your assistant reads them when you mention one, and you can carry any on. Those apps are only read, never changed.

## Bring them in

A new chat offers them in a tip under the box: **Bring in 1,284 past chats**. Point at it to see the apps. It shows once no [earlier tip](../start/first-chat.md#what-the-new-chat-offers-next) is waiting, and **×** hides it for good.

It opens **Settings → What Conch knows → Your past chats**, showing **Found 1,284 conversations** by app and project. <kbd>mod+k</kbd> finds it too ("past chats", "Claude Code").

1. Press **Bring them in**. Nothing to choose, no folder to find.
2. A bar shows progress and which app it's reading. Keep using Conch meanwhile.
3. When done, it says how many keys or passwords were taken out. Press **Search them** to try it.

New chats from those apps then come in by themselves, a few times a day. Only what's new or has grown is read.

## What comes in

- What you said and what the assistant answered. Not its steps (commands, files, results) or its thinking.
- Title, project, date and model, when the app kept them.
- No keys, tokens or passwords. They become •••, as does every password in [Passwords](../features/passwords.md).
- Not Conch's own Claude Code chats (already here), helpers' conversations, routine runs or group chats.

## Find and read them

Past chats stay out of your chat list. They're found everywhere else:

- **<kbd>mod+k</kbd>** finds any line in them. Choosing one opens it beside you, to read. See [Find anything](../features/find.md).
- **Your assistant** finds them when you mention something: "what did we decide about the checkout bug in Claude Code?". What they say is information, never instructions, and anything risky after asks first. See [Memory](../features/memory.md#your-earlier-chats).
- Nothing in them becomes a memory unless you say so.

## Carry one on

**Carry on here** starts a new Conch chat with the conversation in it. The original stays as it was. A chat from Claude Code, Codex, Gemini CLI or Copilot is answered by that provider when connected, otherwise by your usual model.

## Take them out

**Settings → What Conch knows → Your past chats → Take them out** removes them all, after asking. It may ask you to confirm it's you. The source apps keep theirs, chats you carried on stay, and you can bring them in again.

## Good to know

- Conch reads `~/.claude`, `~/.codex`, `~/.gemini`, OpenCode's folder in `~/.local/share`, VS Code's settings folder, `~/.openclaw` and `~/.hermes`, or wherever you moved one (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`).
- Links in those folders aren't followed. Databases open read-only.
- A file Conch can't read is skipped and counted. The rest still comes.
- Cursor's chats aren't read yet.
- Past chats are in your [backups](./backups.md).
