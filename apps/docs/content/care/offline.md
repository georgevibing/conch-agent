---
title: Offline and at a limit
description: Offline, a message waits or the model on this computer answers. At a usage limit, the next plan or key with room carries on.
order: 5
---

Losing the internet or reaching a usage limit never loses your message. It waits and goes by itself, or another provider answers.

## When the internet goes

A line above the message box says **You're offline** and what happens to what you send. You can keep typing and sending.

With no model on this computer, your message waits in the chat under **Waiting for the internet**:

- It goes by itself when you're back.
- Messages sent meanwhile go with it, as one.
- It's part of the chat, so it survives a restart.

With [a model on this computer](../providers/ollama.md), that model answers instead, and a quiet line in the chat says so. This is on from the start.

To turn it off, switch off **And if none has room, the model on this computer** in **Settings → Providers → When one can't answer**. (With **Wait until it resets** chosen, it reads **Answer offline with the model on this computer**.) Messages then wait, each with an **Answer now with** button.

## At a usage limit

When a provider reaches its limit, the next plan or key with room answers the same message, knowing the chat so far. A quiet line says so: "Claude Code reached its limit until 18:00. Codex is answering."

Later messages go to the same provider. Once the limit resets, your usual provider answers again and is told what happened.

### Automatic

On from the start, in **Settings → Providers → When one can't answer**, under **At a usage limit**. It shows what it would do right now. Each choice shows:

- its room and reset time ("72% left · resets 6:00 PM")
- its cost: **Included in your plan**, or **Pay per use** with about what a reply costs
- its model ("Answers with GPT-5.5")

Automatic tries, in order:

1. Your plans, since they cost nothing more.
2. Pay-as-you-go keys, cheapest reply first, only once you turn on **Pay-per-use keys too**.
3. The model on this computer, if you have one and **And if none has room, the model on this computer** is on.

It skips one that's at its own limit, a key past its spending limit, and every key once [this month's budget](./what-it-costs.md) is used up. A chat that uses apps or runs commands only moves to one that can. To reorder, use the arrows under **In this order**.

Codex and Codex CLI share a ChatGPT sign-in, so they're one choice. With two accounts of one kind, each says whose it is: "Codex · ada@work.example".

### The other choices

- **Wait until it resets**: the chat offers another provider for that one message. Use it, and Conch asks whether to next time. **Always** makes that provider carry on.
- **A provider by name**: only that one carries on, while it has room.
- **Back to (your provider) once it resets**: on from the start. Off, a chat stays with whoever carried it on.

In the chat, the line offers:

- **Switch back**: the chat returns to your usual provider and model, and waits for the reset.
- **Change**: opens the setting.

Background tasks carry on the same way. [Routines](../features/routines.md) don't: an unattended run at a limit stops and says so.

## The usage meter

The chip at the top of a chat names its provider and what's left of its tightest limit: "Codex · 62% left". Pick another provider's model, and it switches at once.

Click it to see who you're signed in as, and each limit with what's left and when it resets. If new chats start with another provider, **Use (provider)** changes that.

It says **Sign in** when a sign-in ended, and **Connect a provider** when none is connected.

- **Pay as you go:** the details show spend today and this month. Set a **Monthly budget** in **Settings → Usage** and the chip shows what's left. Near it, a chat says so once. At it, a chat asks before spending more ([What it costs](./what-it-costs.md)). Routines have [their own limit](../features/routines.md#it-wont-run-up-a-bill).
- **Close to a limit:** a line appears above the message box. Close it with **×** and it stays away on every device until that limit resets.
- `/usage` opens the chip's details. **Settings → Usage** shows every provider's limits.

## Good to know

- A chat that uses apps keeps them. Offline, the model on this computer answers with one of its models that can use apps. At a limit, only a plan or key whose model can use apps answers.
- A key that refuses for a limit ("too many requests", "quota") is skipped for 15 minutes, or until the time its provider gave.
- A reply's cost is estimated at list price for a few paragraphs in a medium chat. A long chat costs more.
- Spend counts what you've run through Conch, at list prices. It isn't your provider's bill.
- A chat already on the model on this computer carries on as usual offline.
