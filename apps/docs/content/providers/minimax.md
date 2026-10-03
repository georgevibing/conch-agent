---
provider: minimax
---

## Connect it

1. Open **Settings → Providers** and choose **MiniMax**.
2. Press **Open platform.minimax.io** and create a key, or use your M Plan key.
3. Paste it. Conch checks it before keeping it.

Or paste the key anywhere on **Settings → Providers**. Conch knows whose key it is from its shape and checks it before keeping it.

International and China keys don’t mix. Conch tries both and remembers which took yours.

## What you get

MiniMax’s models: strong at agent and coding work, with a million-token context. MiniMax allows M Plan keys in other apps, so your plan works here.

Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work with models that can call tools.

## Good to know

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled in the picker. If a model turns out not to take tools, Conch asks it again without them and says so.
- **Spend is tracked.** Conch records each turn, and you can set a budget. See [Offline and at a limit](../care/offline.md).
- **Its thinking shows as thinking.** MiniMax thinks out loud inside its answer. Conch shows that as thinking and hands it back between steps, as MiniMax asks.
