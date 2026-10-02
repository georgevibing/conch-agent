---
title: Skills
description: Teach your assistant how you like something done, once, and use it with every model.
order: 2
---

A skill is a set of instructions your assistant follows for one kind of job: your weekly review, a release checklist, the tone of a status update. You write it once, in your own words. It works with every provider, and your assistant reaches for it when a request fits.

## Teach one

1. Open **Skills** in the sidebar and press **New skill**.
2. Describe what it should do: the steps, the tone, what to include and what to leave out.
3. Pause. Conch writes a title and a one-line description for you. Change either if you like.
4. Under **Use it**, choose **Automatically** or **When I ask**, then press **Create skill**.

Not sure where to begin? The page offers a few ideas to start from.

## Use one

Each skill has one of three settings:

- **Automatically.** Your assistant uses it whenever a request fits.
- **When I ask.** Only when you type `/` and its name, such as `/weekly-review`, followed by whatever it should work on.
- **Off.** Never.

Either way, a line in the chat names the skill that shaped the reply. Skills are in <kbd>mod+k</kbd> too: choosing one puts it in the message box, ready to send.

Change the setting on the skill's page, or flip its switch in the list. **Try it in a chat** starts a new chat with the skill filled in.

## Skills you already have

Conch saves a skill as a `SKILL.md`, the format Claude Code, Codex, OpenClaw and Hermes all read. Skills it finds in other assistants' folders appear under **From other apps**.

They start off. Read one, then turn it on. Conch never changes another app's folder: **Make a copy to edit** gives you one of your own.

## What keeps a skill honest

A skill is instructions your assistant follows with your powers, so Conch treats one with care.

- **It's read through first.** Conch reads every file in a skill and says in plain words what could hurt you: running something it downloads, reaching for saved passwords, hiding what it does from you. A worrying skill stays off until you've looked.
- **It's held to what it says.** A skill's page lists what it can do, for example "run commands (only `git`), change files in your work folder". Once a skill is in a chat, anything else it tries asks you first, in every [mode](../reference/modes.md), for the rest of the chat. A line above the message box says **Held to Quick setup's list**; press the name to see the list. Work you hand off from that chat is held the same way.
- **A change turns it off.** If another app's skill changes after you turned it on, it's off again until you look at what it says now.
- **A signature says who made it.** Open a signed skill and press **Trust this publisher…** once. From then on that publisher's skills say **Verified**, and their signed updates stay on. A skill changed after it was signed can't be turned on.

To sign skills you share, see `pnpm conch skills sign` in the [command line reference](../reference/cli.md). Your signing key is locked with this computer's own key, so it only opens here. A passphrase-locked [backup](../care/backups.md) carries it to a new computer.

## Stop holding a chat to a skill

A skill's instructions stay in the chat after the turn it was used in, so the chat stays held to its list. When you're done with it:

1. Press **Stop holding** on the line above the message box, or find **Stop holding this chat to …** in <kbd>mod+k</kbd>.
2. Read what changes, and press **Stop holding**.

The chat says you did, and so does **Activity**. Only you can do this, and not while an answer is being written. A new chat starts with nothing held.

## Skills Conch suggests

When you've asked for the same thing in three different chats, the Skills page offers to save it as a skill, with a first draft written from what you said. Once search [understands meaning](./memory.md#search-that-understands), the words don't have to match: "Write my weekly summary", "Recap this week's meetings" and "What happened at work this week?" count as one thing. A skill you already have is recognised in other words too.

- **Look at the draft** opens it for you to read and change.
- **Not now** hides the offer for a month.
- **Don't suggest this** hides it for good.

Nothing is saved or turned on unless you do it.

## Good to know

- Your skills live in `~/.conch/skills`, one folder each, and are part of every [backup](../care/backups.md).
- A provider that reads a folder by itself may use those skills whatever you choose in Conch. Claude Code does this with its own skills folder, and the skill's page says so.
- The publishers you trust are listed at the bottom of the Skills page. **Forget** stops trusting one.
