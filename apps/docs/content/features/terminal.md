---
source: docs/TERMINAL.md
description: A real shell on the computer Conch runs on, a keystroke away.
order: 6
---

## Commands your assistant keeps running

Your assistant can start a build, test run or server, read its output, send input and stop it. Each command belongs to its chat. Ask "What is still running?" or "Stop that server".

- Commands are sealed when this computer supports it. One that needs the network asks, and the approval says how it runs.
- Never send passwords through command input.
- Up to four run across all chats, two per chat, fewer when memory or the processor is busy. The rest wait, with a reason, and can be stopped before they start.
- Each lasts at most 30 minutes, waiting included.
- Under severe memory pressure, Conch stops one command and briefly holds new work. Its output stays, and it's never rerun by itself. This eases overload; it isn't a hard limit per program.
- The latest 64,000 characters of output are kept.
- Stopping or deleting the chat stops its commands; closing Conch stops all. None resume after a restart.
