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

Conch adjusts how many commands can run to the computer’s available memory and
CPU capacity, up to four across all chats and two in one chat. Extra commands
wait in a bounded queue with a reason you can ask your assistant to read. You
can stop a waiting command before it starts. Each command has a maximum lifetime
of 30 minutes, including its time waiting.

If memory stays under severe pressure, Conch stops one of its managed command
trees and briefly holds new work to stay responsive. Its output remains available;
Conch does not automatically repeat a stopped command, which may already have
changed files or sent something. These protections reduce overload; they are not
hard CPU or memory limits on individual programs.

Conch keeps the latest 64,000 characters of output and says when older output
has been dropped. Stopping or deleting the chat stops its command trees; closing
Conch stops all managed commands. They do not resume after a restart.
