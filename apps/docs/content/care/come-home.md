---
title: Coming from another assistant
description: Bring your memories, persona, skills and routines over from OpenClaw or Hermes, with a look first and Undo after.
order: 7
nav: Come home
---

If OpenClaw or Hermes is on this computer, Conch finds it and shows exactly what would come over. Nothing moves until you say so. The other app's folder is only read, never changed.

## Take a look

When Conch finds one during the welcome, it asks, with **Take a look** and **Not now**. After that, the offer lives in **Settings → Memory**, and <kbd>mod+k</kbd> finds it too.

1. Open **Settings → Memory**. Under **Bring your things from another assistant**, press **Take a look** on the app's card.
2. Read the list. Everything has a tick, and **Show what it says** opens its words. Tick what you want and untick the rest.
3. Press the button at the bottom, which counts your ticks: **Bring 12 things over**. Conch may ask you to confirm it's you.
4. Read the summary: what came over, what didn't and why, and what's left for you to do.

The section only shows when Conch has found one of the two apps.

## What comes over

- **Personality.** Your assistant's name, and how it should behave. The name is ticked only if yours is still "Conch". The instructions are ticked only if you've written none here, because they replace yours.
- **About you.** Added to what's already in About you.
- **Memories.** Ticked, except the ones Conch already has and OpenClaw's daily notes. See [memory](../features/memory.md).
- **Skills.** Conch reads every one first. They come over off, for you to turn on in [Skills](../features/skills.md).
- **Routines.** Scheduled jobs come over as drafts. Nothing runs until you turn it on in [Routines](../features/routines.md).
- **Chat apps.** Your Telegram, Discord or Slack bot. Conch checks it with its app, then it waits for your hello, so nobody else gets in. See [Channels](../channels/index.md).
- **Keys.** Your Anthropic API or OpenRouter key, if Conch has none yet. It goes into Conch's encrypted key file and is never shown.

## What starts unticked

Some things wait for you to read them:

- **Words that read like orders to the assistant**, such as "ignore previous instructions", in a persona, a memory or a routine. Conch says what it found beside each one.
- **A skill that worries Conch** when it reads it through, with what it found.
- **Chat bots and keys.** They never come over unless you tick them yourself.

Invisible characters are removed from the persona, About you, memories and routines that come over.

> [!WARNING]
> A bot answers in one app at a time. Stop OpenClaw or Hermes before you bring its bot over, or both will try to answer.

## Backup first, then Undo

Conch [backs itself up](./backups.md) before it brings anything over.

The summary has an **Undo** button. For a week after, **Settings → Memory** has one too: **Undo that import**. Undo removes what came over and puts back what it replaced: your assistant's name, its instructions and About you. Anything you've already removed yourself is skipped. It may ask you to confirm it's you.

After a week, what came over is yours.

## From the terminal

This lists the same things with their ticks, and changes nothing:

```bash
pnpm conch import --from openclaw --dry-run
```

Use `--from hermes` for Hermes. Without `--dry-run`, it brings the ticked things over, except chat bots and keys, which only come over in the app. It won't do that while Conch is running: use **Settings → Memory**, or quit Conch first. More in [the command line](../reference/cli.md).

## Good to know

- Conch looks in `~/.openclaw` and `~/.hermes`, and in the older `~/.clawdbot` and `~/.moltbot`.
- Links inside those folders aren't followed, so nothing outside them comes along.
- A file Conch can't read stays behind, with a sentence saying why. Everything else still comes.
