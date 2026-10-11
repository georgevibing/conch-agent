---
title: Coming from another assistant
description: Bring your agents, memories, skills and routines over from OpenClaw or Hermes, with a look first and Undo after.
order: 7
nav: Come home
---

If OpenClaw or Hermes is on this computer, Conch shows exactly what would come over. Nothing moves until you say so, and the other app's folder is only read.

## Take a look

A new chat offers it in a short tip under the box: **Bring your things from OpenClaw**. It shows once you've connected an app or put that [tip](../start/first-chat.md#what-the-new-chat-offers-next) away, and goes once your things are over, or for good with its **×**. **Settings → What Conch knows** and <kbd>mod+k</kbd> offer it too.

1. In **Settings → What Conch knows**, under **Bring your things from another assistant**, press **Take a look** on the app's card. It opens under **What Conch knows › From OpenClaw** (or Hermes). Press **What Conch knows** to go back.
2. Each kind of thing (**Agents**, **Memories**, **Skills**…) has a tile with how many are ticked. Press one to see that kind, or **Everything**.
3. Read the list. **Show what it says** opens an item's words. In a long list, search, then **Tick these** or **Untick these**.
4. Press the button at the bottom, such as **Bring 12 things over**. Conch may ask you to confirm it's you.
5. The summary says what came over, what didn't and why, and what's left for you.

The section shows only when Conch has found one of the two apps.

## What comes over

- **Agents.** Each agent, and each Hermes profile, becomes an agent here, all ticked. Each keeps its picture (or one of Conch's matched to its emoji), its name (numbered if one of yours has it), its tone, its instructions from SOUL.md and what you added to AGENTS.md, and its model if Conch can run it. Its routines and chat bot stay with it. **New chats start with** picks theirs or yours. Bringing them again updates them instead of copying. See [agents](../features/agents.md).
- **Model.** The one you used there, for new chats ("Use Claude Sonnet, as in Hermes"), or the nearest of its family among your providers. Ticked only if you haven't chosen a model. If no provider can run it, the list says why and nothing changes. See [providers](../providers/index.md).
- **About you.** Added to yours.
- **Memories.** Ticked, except ones Conch already has and OpenClaw's daily notes. See [memory](../features/memory.md).
- **Skills.** Read through first, and off until you turn them on in [Skills](../features/skills.md).
- **Routines.** Drafts, until you turn them on in [Routines](../features/routines.md).
- **Chat apps.** Your Telegram, Discord or Slack bot. Conch checks it, then waits for your hello, so nobody else gets in. See [Talk to me here](../channels/index.md).
- **Keys.** Your Anthropic API or OpenRouter key, if Conch has none. It goes into Conch's encrypted key file and is never shown.
- **Another agent's things.** Its memories, skills and routines, under its name with one tick. Memories are shared by every agent.

## A Slack bot with one key

Slack needs two keys, and the other app may have kept one. Tick the bot anyway, then press **Finish connecting Slack** in the summary:

1. The Slack setup opens with the app made and the key Conch has done.
2. Press the button to open your app's page in Slack: **Socket Mode** for a missing app-level token, **Install App** for a missing bot token.
3. Paste the key. Conch checks it, connects, and waits for your hello.

**Connect Slack** also offers the key it found, with **Use it**.

## What starts unticked

- **Words that read like orders to the assistant**, such as "ignore previous instructions", in an agent, memory or routine. Conch says what it found.
- **A skill that worries Conch**, with why.
- **Chat bots and keys.** Only if you tick them.

Conch also cleans what comes over:

- Invisible characters are removed from agents, About you, memories and routines.
- Anything in an agent's words that looks like a key or password is left out, and the list says so.
- Instructions come whole, up to 100,000 characters, with a warning when they're long enough to cost on every reply. An agent an earlier Conch brought cut short gets the rest.
- Pictures come only from the agent's own folder, never the web, without what a camera writes in them.

> [!WARNING]
> A bot answers in one app at a time. Stop OpenClaw or Hermes before you bring its bot over, or both will answer.

## Backup first, then Undo

Conch [backs itself up](./backups.md) first. The summary has **Undo**, and for a week **Settings → What Conch knows** has **Undo that import**. It may ask you to confirm it's you.

Undo removes what came over, including a Slack bot finished later. It puts back the agents it updated, the agent and model new chats start with, and About you. It skips what you've already removed. After a week, what came over is yours.

## From the terminal

This lists the same things with their ticks, and changes nothing:

```bash
conch import --from openclaw --dry-run
```

Use `--from hermes` for Hermes. Without `--dry-run`, it brings the ticked things over, except chat bots and keys (those need the app). Quit Conch first, or use **Settings → What Conch knows**. More in [the command line](../reference/cli.md).

## Good to know

- Conch looks in `~/.openclaw`, `~/.hermes`, and the older `~/.clawdbot` and `~/.moltbot`.
- It doesn't follow links out of those folders.
- A file it can't read stays behind, with why. Everything else comes.
