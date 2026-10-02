---
provider: anthropic-api
---

## Connect it

1. Create a key in the [Anthropic Console](https://console.anthropic.com/settings/keys). It starts with `sk-ant-`.
2. Open **Settings → Providers**, find **Anthropic API** and press **Connect**.
3. Paste the key. Conch checks it before keeping it.

Usage is billed to that Console account. There is no subscription, and nothing else to install.

## What you get

Every Claude model, straight from Anthropic. Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work.

## Good to know

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled before answering and cannot perform actions.
- **Spend is tracked.** Conch records what each turn cost, and you can set a budget. See [Offline and at a limit](../care/offline.md).
