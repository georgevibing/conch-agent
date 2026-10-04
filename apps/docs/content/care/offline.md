---
title: Offline and at a limit
description: A message sent offline waits or is answered on this computer, and at a usage limit the provider you chose carries on.
order: 5
---

Two things can stop a provider answering: the internet goes, or you reach a usage limit. Neither loses your message. It waits and goes by itself, or another provider answers, the way you chose beforehand.

## When the internet goes

A line above the message box says **You're offline**, and what will happen to what you send. You can keep typing and sending.

With no model on this computer, your message waits in the chat under **Waiting for the internet**. It goes by itself the moment you're back. Messages you send meanwhile go with it, as one. A waiting message is part of the chat, so it's still there after Conch restarts.

With [a model on this computer](../providers/ollama.md), that model answers instead, and one quiet line in the chat says so. This is on from the start, and only matters once a model is set up.

To turn it off, open **Settings → Models → When a provider can't answer** and switch off **Answer offline with the model on this computer**. Messages then wait, and each waiting one has an **Answer now with** button for the times you'd rather not.

## At a usage limit

When a provider reaches its limit, the chat says so. If another provider is connected, a button offers to answer with it for now. Conch doesn't switch by itself until you say so, because another provider may cost money.

Press that button, and Conch asks whether to do the same next time. **Always** makes the choice below for you.

Or choose it yourself, before you need it:

1. Open **Settings → Models → When a provider can't answer**.
2. Under **At a usage limit**, choose **Continue with** and the provider you want.

From then on, that provider answers the same message, with nothing to retype. One line in the chat says who answered and why, with **Change** beside it. Once the limit resets, your usual provider answers again.

Choose **Wait until it resets** to go back to waiting.

## The usage meter

The small gauge at the top of the window shows what's left of your tightest limit, like a battery: "62% left". Click it to see each of your plan's limits, what's left of it, and when it resets.

If you pay as you go, it shows what you've spent today and this month instead. Set a **Monthly budget** in **Settings → Usage**, and the gauge shows what's left of that. Near it, a chat says so once; at it, a chat asks before spending more ([What it costs](./what-it-costs.md)). Routines have [a limit of their own](../features/routines.md#it-wont-run-up-a-bill) for what they spend while you're away.

A line appears above the message box only when a limit is close or reached. Type `/usage`, or open **Settings → Usage**, to see the same numbers.

## Good to know

- A chat that uses apps keeps them when another model answers. Offline, the model on this computer answers with one of its models that can use apps. At a limit, your pick answers only if the model it uses can.

- The meter follows the provider your new chats start with.
- Spend counts what you've run through Conch, at list prices. It isn't your provider's bill.
- A chat that already uses the model on this computer carries on as usual offline.
