---
title: For other agents
description: How another AI agent works with Conch, without reading its files or its code. Moving routines over is the common case.
order: 9
---

Another agent (Hermes, OpenClaw, a script of your own) has two ways to work with Conch:

- **In your terminal**, on the computer Conch runs on, with the `conch` command. Having the terminal is having the computer, so it acts for you.
- **Through the door for other agents**, over [A2A](../features/agents.md#let-another-agent-talk-to-yours), with a key you made for it. It talks to one of your agents in words, and can ask you for things. It can never answer for you.

Neither needs Conch's files in `~/.conch`. Read the commands' output instead: the files change between versions.

## Move routines to another agent

You asked another agent to take over some routines and switch Conch's off.

1. It lists them, with their schedules and next runs:

   ```bash
   conch routines --json
   ```

2. It reads what each one needs to recreate it:

   ```bash
   conch routines export --json
   ```

3. It sets them up on its side, then pauses Conch's, with a reason you'll see in **Routines**:

   ```bash
   conch routines pause "Weekly fitness recap" --reason "moved to Hermes"
   ```

`conch routines resume <name>` turns one back on. A name works where it's clear; otherwise use the id from the list.

### What `export --json` gives

One document, `"format": "conch.routines/1"`, with a `routines` list. Each routine has:

| Field        | What it is                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name` | Conch's id, and its name as you see it                                                                                    |
| `prompt`     | The whole instruction each run is given                                                                                   |
| `schedule`   | `text` in words, `timezone`, Conch's own `structured` form, `cron` where cron says it exactly, the `next` runs (ISO 8601) |
| `when`       | What starts it instead, for a routine that starts when something happens                                                  |
| `delivery`   | Results stay in Conch's history; `channels` lists the chat apps its instruction sends to                                  |
| `uses`       | `paths` and `urls` its instruction or trigger names, and the provider and model it runs on                                |
| `status`     | `active`, `paused`, `draft` or `completed`, and `pausedBecause` when someone said why                                     |
| `trust`      | How far a run goes without asking: `ask`, `auto` or `full`                                                                |

It never holds a key, a password or another app's address. Without `--json`, `export` prints the same as Markdown, for a person.

### Over the door

An agent you let in can ask in words: "I run your weekly fitness recap now, please pause yours." Your agent doesn't refuse, and doesn't do it either:

- You get a notification, and a card at the top of **Routines**: "Hermes asks to pause “Weekly fitness recap”", with its reason, **Pause it** and **Decline**.
- Its task stays `working`. Once you answer, `GetTask` says what you chose.
- Nothing it writes counts as your answer. Only your press does.

Its card lists this as the `routine-handoff` skill.

## Good to know

- Conch's own assistant can't run `conch routines pause` or `resume`. It has its own way to pause one, and only you turn one back on.
- A routine that was never turned on stays off until you press **Turn on** on its card.
- `conch help routines` says the same in the terminal.
