---
provider: ollama-cloud
---

## Connect it

Two ways, and no key is needed for the first.

- **Sign in through the Ollama app.** If Ollama is on this computer, press **Sign in with Ollama**. Ollama’s page opens; sign in to your account there, and this updates by itself. Conch reaches the cloud models through the app, which signs each request with this computer’s own key.
- **Use a key.** Press **Open ollama.com**, create a key and paste it. Conch then talks to Ollama’s cloud directly.

## What you get

Big open models on Ollama’s servers, for when this computer is too small to run them. Conch asks Ollama what each model can do (tools, pictures, thinking) and how much it can read.

Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work with models that can call tools.

## Good to know

- **Not offline.** These models run on Ollama’s servers, not this computer. For a model that stays here, use [On this computer](ollama.md).
- **Ollama’s plans are usage credits.** The free plan includes starter credit. See your usage in your Ollama account.
- **Conch supplies the tools.** Tool-capable models can use memory, connected apps and files in this conversation’s work folder, with the same permission checks and Undo tracking. Commands require the OS sandbox, cannot access the network and have no unrestricted fallback. Chat-only models are labelled in the picker. If a model turns out not to take tools, Conch asks it again without them and says so.
