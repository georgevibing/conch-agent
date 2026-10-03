---
provider: mistral
---

## Connect it

1. Open **Settings → Providers** and choose **Mistral**.
2. Press **Open console.mistral.ai** and create a key. The free plan needs no card.
3. Paste it. Conch checks it before keeping it.

Or paste the key anywhere on **Settings → Providers**. Conch knows whose key it is from its shape and checks it before keeping it.

## What you get

Mistral’s models from Europe, good all-round. Conch keeps one name for each model, even when Mistral lists it twice.

Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work with models that can call tools.

## Good to know

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled in the picker. If a model turns out not to take tools, Conch asks it again without them and says so.
- **Spend is tracked.** Conch records each turn, and you can set a budget. See [Offline and at a limit](../care/offline.md).
- **Mistral keys have no prefix.** Paste it on the model’s own page, or choose **Mistral** when Conch asks whose a key is.
