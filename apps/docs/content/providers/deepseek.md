---
provider: deepseek
---

## Connect it

1. Open **Settings → Providers** and choose **DeepSeek**.
2. Press **Open platform.deepseek.com**, create a key and top up its balance.
3. Paste it. Conch checks it before keeping it.

Or paste the key anywhere on **Settings → Providers**. Its keys don’t start with anything only it uses, so Conch asks you whose it is, then checks it before keeping it.

## What you get

DeepSeek’s models: strong reasoning at a very low price. You see the model think, and Conch hands its thinking back between tool steps, as DeepSeek requires.

Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work with models that can call tools.

## Good to know

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled in the picker. If a model turns out not to take tools, Conch asks it again without them and says so.
- **Spend is tracked.** Conch records each turn, and you can set a budget. See [Offline and at a limit](../care/offline.md).
- **A plain `sk-` key could be anyone’s.** Keys from DeepSeek, OpenAI, Kimi and Qwen can start the same way. When you paste one on the Providers page, Conch asks whose it is rather than send it to the wrong company.
