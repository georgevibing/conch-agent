---
provider: openrouter
---

## Connect it

1. Open **Settings → Providers** and find **OpenRouter**.
2. Press **Connect**.
3. Sign in to OpenRouter on the page that opens. It makes a key for Conch, with nothing to copy. Or paste a key you have: it starts with `sk-or-`.

## What you get

Models from every lab in one list (Claude, GPT, Gemini, Llama and more), each with its price. You pay OpenRouter as you go.

Conch runs the chat and supplies the tools: your [apps](../features/apps.md), [memory](../features/memory.md), [skills](../features/skills.md), the [browser](../features/browser.md), files with **Undo** and sealed commands. Anything that changes asks first. Models without tools show **Chat only**. Spend counts toward your [budget](../care/offline.md).

## Good to know

- **A Chat only model still gets tools.** Conch lists them in its instructions so it can try. That works for any OpenRouter model, not only the ones the picker shows.
- **What a model already read costs less.** Conch asks Claude and Gemini to cache the instructions and chat. The others cache by themselves.
- **A busy model is waited for.** Conch retries a few seconds later. If it's still busy, the chat goes to your [fallback](../care/offline.md).
- **A key with an end date** shows when it runs out on its card, from two weeks before. After that, make a new one at openrouter.ai and press **Add a key**.
- **Pictures work** with models that can see. A file card warns when the chosen model can't use it.
