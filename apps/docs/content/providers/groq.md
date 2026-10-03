---
provider: groq
---

## Connect it

1. Open **Settings → Providers** and choose **Groq**.
2. Press **Open console.groq.com** and create a key. It starts with `gsk_`.
3. Paste it. Conch checks it before keeping it.

Or paste the key anywhere on **Settings → Providers**. Conch knows whose key it is from how it starts, and checks it before keeping it.

## What you get

Open models with very fast answers, and a free tier to start. Good when speed matters most, and for voice.

Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work with models that can call tools.

## Good to know

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled in the picker. If a model turns out not to take tools, Conch asks it again without them and says so.
- **Spend is tracked.** Conch records each turn, and you can set a budget. See [Offline and at a limit](../care/offline.md).
- **A rate limit waits, then retries.** Groq says how long to wait. Conch waits that long once or twice, and tells you in the chat.
