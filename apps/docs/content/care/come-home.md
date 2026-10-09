---
title: Coming from another assistant
description: Bring your agents, memories, skills and routines over from OpenClaw or Hermes, with a look first and Undo after.
order: 7
nav: Come home
---

If OpenClaw or Hermes is on this computer, Conch finds it and shows exactly what would come over. Nothing moves until you say so. The other app's folder is only read, never changed.

## Take a look

When Conch finds one, a new chat offers it in one short tip under the box: **Bring your things from OpenClaw**. It shows once you've connected an app or put that [tip](../start/first-chat.md#what-the-new-chat-offers-next) away, and goes away once they've come over, or for good with its **×**. The offer also lives in **Settings → Memory**, and <kbd>mod+k</kbd> finds it too.

1. Open **Settings → Memory**. Under **Bring your things from another assistant**, press **Take a look** on the app's card. It opens as a page inside Settings, with **Memory › From OpenClaw** (or Hermes) above it: press **Memory** to go back.
2. Look at the tiles: one for each kind of thing (**Agents**, **Memories**, **Skills**…), with how many are ticked. Press a tile to see just that kind, or **Everything** to see it all.
3. Read the list. Everything has a tick, and **Show what it says** opens its words. A long list has its own search: find what you want, then **Tick these** or **Untick these**.
4. Press the button at the bottom, which counts your ticks and stays in reach however long the list: **Bring 12 things over**. Conch may ask you to confirm it's you.
5. Read the summary: what came over, what didn't and why, and what's left for you to do.

The section only shows when Conch has found one of the two apps.

## What comes over

- **Agents.** Each agent you had there, and each Hermes profile, becomes an agent of its own here, with its face beside its name: its picture, or one of Conch's matched to its emoji. Its name (with a number if one of yours has it), its tone, its instructions from SOUL.md and what you added to AGENTS.md, and its own model if Conch can run it. All are ticked. **New chats start with** picks the one that starts new chats: theirs, or yours as now. The routines and the chat bot an agent had stay with it. Bringing them again brings them up to date instead of making them twice. See [agents](../features/agents.md).
- **Model.** The one you used there, for new chats: "Use Claude Sonnet, as in Hermes". Conch finds the same model, or the nearest of its family, among the providers you've connected. It's ticked only if you haven't chosen a model yourself. If none can run it, the list says why under what stays behind, and nothing changes. See [providers](../providers/index.md).
- **About you.** Added to what's already in About you.
- **Memories.** Ticked, except the ones Conch already has and OpenClaw's daily notes. See [memory](../features/memory.md).
- **Skills.** Conch reads every one first. They come over off, for you to turn on in [Skills](../features/skills.md).
- **Routines.** Scheduled jobs come over as drafts. Nothing runs until you turn it on in [Routines](../features/routines.md).
- **Chat apps.** Your Telegram, Discord or Slack bot. Conch checks it with its app, then it waits for your hello, so nobody else gets in. See [Talk to me here](../channels/index.md).
- **Keys.** Your Anthropic API or OpenRouter key, if Conch has none yet. It goes into Conch's encrypted key file and is never shown.
- **What another agent knew and did.** Its memories, skills and routines are listed under its name, with one tick for all of it, and come over like the main agent's. Memories are yours, for every agent.

## A Slack bot with one key

Slack needs two keys, and the other app may have kept only one. Tick the bot anyway. The summary then has **Finish connecting Slack**:

1. The Slack setup opens with the app already made and the key Conch has already done.
2. Press the button to open your app's page in Slack: **Socket Mode** if the app-level token is missing, **Install App** if the bot token is. The step says which button to press there.
3. Paste the key. Conch checks it with Slack, connects, and waits for your hello.

If you open **Connect Slack** yourself, Conch offers the key it found, with **Use it**.

## What starts unticked

Some things wait for you to read them:

- **Words that read like orders to the assistant**, such as "ignore previous instructions", in an agent, a memory or a routine. Conch says what it found beside each one.
- **A skill that worries Conch** when it reads it through, with what it found.
- **Chat bots and keys.** They never come over unless you tick them yourself.

Invisible characters are removed from the agents, About you, memories and routines that come over. Anything in an agent's words that looks like a key or a password is left out; the list says so. Instructions come over whole, up to 100,000 characters, with a word when they're long enough to cost on every reply. An agent an earlier Conch brought with only the start of its instructions gets the rest. A picture is read only from the agent's own folder, never from the web, and kept without what a camera writes in it.

> [!WARNING]
> A bot answers in one app at a time. Stop OpenClaw or Hermes before you bring its bot over, or both will try to answer.

## Backup first, then Undo

Conch [backs itself up](./backups.md) before it brings anything over.

The summary has an **Undo** button. For a week after, **Settings → Memory** has one too: **Undo that import**. Undo removes what came over, a Slack bot you finished later included, and puts back what it replaced: the agents it brought up to date, the agent new chats start with, About you and the model new chats start with. Anything you've already removed yourself is skipped. It may ask you to confirm it's you.

After a week, what came over is yours.

## From the terminal

This lists the same things with their ticks, and changes nothing:

```bash
conch import --from openclaw --dry-run
```

Use `--from hermes` for Hermes. Without `--dry-run`, it brings the ticked things over, except chat bots and keys, which only come over in the app. It won't do that while Conch is running: use **Settings → Memory**, or quit Conch first. More in [the command line](../reference/cli.md).

## Good to know

- Conch looks in `~/.openclaw` and `~/.hermes`, and in the older `~/.clawdbot` and `~/.moltbot`.
- Links inside those folders aren't followed, so nothing outside them comes along.
- A file Conch can't read stays behind, with a sentence saying why. Everything else still comes.
