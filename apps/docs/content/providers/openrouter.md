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

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Models that weren't made for tools are labelled **Chat only** in the picker; if you use one anyway, Conch lists the tools in its instructions so it can still try. This works for any model OpenRouter has, not only the ones the picker shows.
- **Spend is tracked.** Conch records what each turn cost, and you can set a budget. See [Offline and at a limit](../care/offline.md).
- **A key with an end date** says when it runs out on its card, from two weeks before. Once it's past, OpenRouter no longer knows the key: make a new one at openrouter.ai and press **Add a key**.
- **Pictures work** with models that can see. A file card warns you when the chosen model can't use it.
