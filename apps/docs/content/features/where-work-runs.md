---
title: Where work runs
description: Run your assistant's commands on this computer, in a locked-down container, on a machine you reach with SSH, or in the cloud.
order: 10
---

Commands run on this computer, in the sealed box: they can change your work folder and reach package registries, GitHub, GitLab, Bitbucket and your work folder's own remotes, but not the rest of the network or your keys. For one chat or every new one, you can send them to:

- **A container**: a fresh, locked-down box on this computer per command. It sees only your work folder.
- **Your machine**: a computer you reach with SSH. Conch copies the work folder there before each command and brings back what changed.
- **The cloud**: a [Daytona](https://www.daytona.io) sandbox per chat. It sleeps after 15 idle minutes and wakes with its files.

## Choose it for a chat

1. Press the **Model · Mode** chip under the message box. **Where work runs** appears once another place is ready.
2. Choose a place. Its mark shows in the chip.
3. Press **Make this my default** to use it, with this model and mode, for every new chat.

Each command's row says where it ran: **container**, the machine's name, or **cloud**.

## Get a place ready

A place that needs something shows **Add a key** or **Set it up**, which opens the right spot in Settings.

- **A container** needs Docker or Podman. Settings offers **Install Podman**, no administrator needed. Docker Desktop, OrbStack and Podman start when needed. The first command takes a minute or two to fetch the system.
- **Your machine** is any host in your SSH settings. Conch uses your own keys and never asks for a password. Connect once from a terminal first if the host is new.
- **The cloud** needs a Daytona key. Press **Daytona** in the list, or open **Settings → Security → Advanced → Where work runs**, paste it and press **Use Daytona**. It's sealed and never shown again.

If a place stops answering, commands wait rather than run elsewhere. Your assistant tells you, and **Repair everything** in **Settings → Health** says what to do.

## What each place keeps from your computer

|                  | This computer                                  | A container                | Your machine                 | The cloud                    |
| ---------------- | ---------------------------------------------- | -------------------------- | ---------------------------- | ---------------------------- |
| Sees             | Your work folder                               | Your work folder only      | A copy of it                 | A copy of it                 |
| Your keys        | Kept out                                       | Not there                  | Not sent                     | Not sent                     |
| The network      | Registries and code hosts; the rest asks first | Asks first                 | That machine's own           | Yes                          |
| What's left over | Your files, as you left                        | Nothing outside the folder | Its copy, in `~/.conch-work` | Removed after 30 days unused |

- Remote commands are checked as if they left the sealed box. In **Auto**, routine work goes ahead and serious things ask ([permission modes](../reference/modes.md)).
- `node_modules`, `.venv` and similar stay on each side. Your assistant installs them where the work runs.

## Which providers it applies to

All providers run commands where you choose, except **Codex CLI**, which always runs its own on this computer, in its own sandbox, and says so. Pick another provider to run work elsewhere.

Files your assistant edits directly are edited here, in your work folder. The next remote command sees them.
