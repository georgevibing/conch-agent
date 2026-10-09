---
title: Where work runs
description: Run your assistant's commands on this computer, in a locked-down container, on a machine you reach with SSH, or in the cloud.
order: 10
---

Your assistant's commands run on this computer, in the sealed box: they can change
your work folder, but can't reach the network or read your keys. You can also send
them somewhere else, for one chat or for every new one:

- **A container.** A fresh, locked-down box on this computer for each command. It
  sees only your work folder. Your keys, settings and other files aren't in it.
- **Your machine.** A computer you already reach with SSH, like a server or a
  desktop in another room. Conch copies the work folder there before each command and
  brings back what the command changed.
- **The cloud.** A sandbox at [Daytona](https://www.daytona.io), one for each chat.
  It sleeps after 15 idle minutes and wakes with its files still there.

## Choose it for a chat

1. Press the **Model · Mode** chip under the message box. **Where work runs** is in
   it once somewhere other than this computer is ready.
2. Choose a place. A small mark for it appears in the chip, before the mode.
3. To use it for every new chat, press **Make this my default** at the foot. It keeps
   the model and the mode you chose too.

Each command's row in the chat says where it ran: **container**, the machine's name,
or **cloud**. Commands that ran on this computer have no tag.

## Getting a place ready

You don't set anything up by hand. A place that needs something first says so in
the list, with **Add a key** or **Set it up** after it. Press it and Settings opens
at the right place, ready to use.

- **A container** needs Docker or Podman. If neither is here, Settings offers
  **Install Podman**, which needs no administrator. Docker Desktop, OrbStack and
  Podman are started for you when a command needs them. The first command fetches the
  container's system once, which takes a minute or two.
- **Your machine** is any machine named in your SSH settings. Conch connects the way
  you do, with your own keys, and never asks for a password. If the machine is new
  to this computer, connect to it once from a terminal first.
- **The cloud** needs a Daytona key. Press **Daytona** in the list, or open
  **Settings → Security → Advanced → Where work runs**. Paste the key and press
  **Use Daytona**. It's kept sealed on this computer and never shown again.

If a place stops answering, the command doesn't run anywhere else. The chip's mark
shows it's waiting, the assistant tells you, and **Repair everything** in **Settings → Health**
says what to do.

## What each place keeps from your computer

|                  | This computer           | A container                | Your machine                 | The cloud                    |
| ---------------- | ----------------------- | -------------------------- | ---------------------------- | ---------------------------- |
| Sees             | Your work folder        | Your work folder only      | A copy of it                 | A copy of it                 |
| Your keys        | Kept out                | Not there                  | Not sent                     | Not sent                     |
| The network      | Asks first              | Asks first                 | That machine's own           | Yes                          |
| What's left over | Your files, as you left | Nothing outside the folder | Its copy, in `~/.conch-work` | Removed after 30 days unused |

On your machine and in the cloud, every command is checked as if it left the sealed
box. In **Auto**, routine work goes ahead and anything serious still asks
([permission modes](../reference/modes.md)). Folders that are rebuilt rather than
copied, like `node_modules` and `.venv`, stay on each side; your assistant installs
them where the work runs.

## Which providers it applies to

Claude Code, Codex, Copilot, Gemini CLI, Grok, local models and the pay-as-you-go
providers all run their commands where you choose. **Codex CLI** runs its own
commands on this computer, in its own sandbox, wherever you choose; the panel says so
when it's answering. Pick another provider for that chat to run work elsewhere.

Files your assistant reads or edits directly are always edited here, in your work
folder. With your machine or the cloud, the next command sees those edits.
