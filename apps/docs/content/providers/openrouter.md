---
provider: openrouter
---

## Connect it

1. Open **Settings → Providers** and find **OpenRouter**.
2. Press **Connect**.
3. Sign in to OpenRouter in the page that opens, and it makes a key for Conch. Nothing to copy. Or paste a key you already have: it starts with `sk-or-`.

Conch checks the key before keeping it.

## What you get

Models from every lab in one list (Claude, GPT, Gemini, Llama and more), each with its price beside it. You pay OpenRouter as you go.

Conch runs the conversation itself: it keeps the thread, holds the connections to your [apps](../features/apps.md) and hands the model their tools, and asks you before anything changes. So apps, [memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work, with models that can call tools.

## Good to know

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled before answering and cannot perform actions.
- **Spend is tracked.** Conch records what each turn cost, and you can set a budget. See [Offline and at a limit](../care/offline.md).
- **What a model already read costs less.** Claude and Gemini models are asked to keep the instructions and the chat in their cache, and the others keep it by themselves, so each step of a long job pays full price only for what's new.
- **A busy model is waited for.** When OpenRouter says to slow down, Conch tries again a few seconds later by itself, then hands the chat to your [fallback](../care/offline.md) if it's still busy.
- **A key with an end date** says when it runs out on its card, from two weeks before. Once it's past, OpenRouter no longer knows the key: make a new one at openrouter.ai and press **Add a key**.
- **Pictures work** with models that can see. A file card warns you when the chosen model can't use it.
