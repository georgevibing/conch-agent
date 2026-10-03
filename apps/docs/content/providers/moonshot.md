---
provider: moonshot
---

## Connect it

1. Open **Settings → Providers** and choose **Kimi**.
2. Press **Open platform.kimi.ai**, top up at least $1 and create a key.
3. Paste it. Conch checks it before keeping it.

Or paste the key anywhere on **Settings → Providers**. Its keys don’t start with anything only it uses, so Conch asks you whose it is, then checks it before keeping it.

Keys from platform.kimi.ai and platform.kimi.com don’t mix. Conch tries the international address first, then the one in China, and remembers which took your key.

## What you get

Moonshot’s Kimi models: very long context, strong at coding and agent work.

Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work with models that can call tools.

## Good to know

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled in the picker. If a model turns out not to take tools, Conch asks it again without them and says so.
- **Spend is tracked.** Conch records each turn, and you can set a budget. See [Offline and at a limit](../care/offline.md).
- **Pay-as-you-go keys only.** The Kimi Code plan is for the coding tools Moonshot lists.
