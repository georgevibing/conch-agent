---
provider: gemini
---

## Connect it

1. Open **Settings → Providers** and choose **Google Gemini**.
2. Press **Open aistudio.google.com** and create a key. It’s free, and starts with `AIza` or `AQ.`.
3. Paste it. Conch checks it before keeping it.

Or paste the key anywhere on **Settings → Providers**. Conch knows whose key it is from its shape and checks it before keeping it.

## What you get

Google’s Gemini models with a very long context, good with pictures. The free tier needs no card. A paid key raises the limits.

Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work with models that can call tools.

## Good to know

- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled in the picker. If a model turns out not to take tools, Conch asks it again without them and says so.
- **Spend is tracked.** Conch records each turn, and you can set a budget. See [Offline and at a limit](../care/offline.md).
- **Free use may train Google’s products.** On the free tier, Google may use what you send to improve them. Paid use isn’t used that way.
- **Prefer to sign in with your Google account?** Connect [Gemini CLI](gemini-cli.md) instead.
