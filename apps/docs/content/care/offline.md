---
title: Offline and at a limit
description: A message sent offline waits or is answered on this computer, and at a usage limit the next plan or key with room carries on.
order: 5
---

Two things can stop a provider answering: the internet goes, or you reach a usage limit. Neither loses your message. It waits and goes by itself, or another provider answers.

## When the internet goes

A line above the message box says **You're offline**, and what will happen to what you send. You can keep typing and sending.

With no model on this computer, your message waits in the chat under **Waiting for the internet**. It goes by itself the moment you're back. Messages you send meanwhile go with it, as one. A waiting message is part of the chat, so it's still there after Conch restarts.

With [a model on this computer](../providers/ollama.md), that model answers instead, and one quiet line in the chat says so. This is on from the start, and only matters once a model is set up.

To turn it off, open **Settings → Providers → When one can't answer** and switch off **And if none has room, the model on this computer** (with **Wait until it resets** chosen, it reads **Answer offline with the model on this computer**). Messages then wait, and each waiting one has an **Answer now with** button for the times you'd rather not.

## At a usage limit

When a provider reaches its limit, the next plan or key with room carries on, with nothing to retype. It answers the same message, and knows what was said and done in the chat so far. One quiet line in the chat says so: "Claude Code reached its limit until 18:00. Codex is answering." The next messages go to the same one without a second line. Once the limit resets, your usual provider answers again, and it's told what happened meanwhile.

This is **Automatic**, and it's on from the start. You'll find it, and what it would do right now, in **Settings → Providers → When one can't answer**, under **At a usage limit**. Each choice there says:

- whether it has room now, and when its limit resets ("72% left · resets 6:00 PM"),
- what it costs: **Included in your plan**, or **Pay per use** with about what a reply costs,
- the model it answers with ("Answers with GPT-5.5").

Automatic goes through them in order. Your own plans come first, since they cost nothing more. Then the keys you pay as you go, the cheapest reply first. It passes over one that's at its own limit, a key past its own spending limit, and every key once [this month's budget](./what-it-costs.md) is used up. It passes over one that can't do what the chat does, too: a chat that uses apps or runs commands only moves to one that can. To change the order, use the arrows under **In this order**.

Codex and Codex CLI use the same ChatGPT sign-in, so they're one choice. If you're signed in to two accounts of the same kind, each says whose it is: "Codex · ada@work.example".

If none has room, the model on this computer answers, when you have one and **And if none has room, the model on this computer** is on.

The other choices:

- **Wait until it resets**: the chat says the limit was reached, and offers another provider for that one message. Press it, and Conch asks whether to do the same next time. **Always** picks that provider for you.
- **A provider by name**: only that one carries on, while it has room.
- **Back to (your provider) once it resets**: on from the start. Switch it off, and a chat stays with whoever carried it on.

In the chat, the line has **Switch back** beside it. Press it, and the chat is your usual provider's again, with the model it had: it waits for the limit to reset instead of letting another carry on. **Change** opens the setting.

Tasks you've sent to the background carry on the same way. [Routines](../features/routines.md) don't: an unattended run at a limit stops and says so, rather than spend on another provider while you're away.

## The usage meter

The chip at the top of a chat names the provider answering it and shows what's left of its tightest limit, like a battery: "Codex · 62% left". It follows the chat: pick a model from another provider and it shows that provider's limits at once. Click it to see who you're signed in as, each of the plan's limits, what's left of it, and when it resets. If that provider isn't the one new chats start with, **Use** makes it so.

If the chat's provider needs you (a sign-in that ended), the chip says **Sign in** instead. With no provider connected, it says **Connect a provider**.

If you pay as you go, the details show what you've spent today and this month. Set a **Monthly budget** in **Settings → Usage**, and the chip shows what's left of that. Near it, a chat says so once; at it, a chat asks before spending more ([What it costs](./what-it-costs.md)). Routines have [a limit of their own](../features/routines.md#it-wont-run-up-a-bill) for what they spend while you're away.

A line appears above the message box when the chat's provider is close to its limit. Close it with **×** and it stays away, on every device, until that limit resets; if the next one gets close too, it says so again. Type `/usage` to open the chip's details, or open **Settings → Usage** to see every connected provider's limits at once.

## Good to know

- A chat that uses apps keeps them when another model answers. Offline, the model on this computer answers with one of its models that can use apps. At a limit, a plan or key answers only if the model it uses can.
- A key that refuses for a limit (its provider says "too many requests" or "quota") is passed over for a quarter of an hour, or until the time its provider gave.
- About what a reply costs is worked out at list price for a reply of a few paragraphs in a chat of some length. A long chat costs more.

- The meter follows the provider your new chats start with.
- Spend counts what you've run through Conch, at list prices. It isn't your provider's bill.
- A chat that already uses the model on this computer carries on as usual offline.
