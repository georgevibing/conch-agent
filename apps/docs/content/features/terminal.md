---
source: docs/TERMINAL.md
description: A real shell on the computer Conch runs on, a keystroke away.
order: 6
---

## Commands your assistant keeps running

For a build, test run or development server, your assistant can start a managed
command, read its progress, send input and stop it. Each belongs to the chat
that started it. Ask “What is still running?” or “Stop that server”.

Commands are sealed when this computer supports it and sealing is on. A command
that needs the network can ask to run with your access. The approval says which
way it runs. Never send passwords through command input.

Up to four commands run per chat, with a maximum lifetime of 30 minutes each.
Conch keeps the latest 64,000 characters of output and says when older output
has been dropped. Stopping or deleting the chat stops its command trees; closing
Conch stops all managed commands. They do not resume after a restart.
