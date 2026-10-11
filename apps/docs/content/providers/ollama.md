---
provider: ollama
---

## Set it up

1. Open **Settings → Providers → On this computer**.
2. Press **Get** on the suggested model, like **Get Qwen3 4B**. It shows the size and download time.
3. If Ollama isn't here, the same press installs it. On Linux, Conch links to Ollama's installer and notices when it's there.

You can pause the download. When it finishes, the model is in the picker.

## Which model

Conch offers only models that can use tools, sized to this computer's memory: under 2 GB on a small laptop, up to about 23 GB on a workstation. If memory or disk is short, it says by how much and offers no button.

## What it's for

- **Private.** Your chats go to no AI company.
- **Free.** Nothing to pay, and no limit.
- **Offline.** It answers on a train, and takes over when the internet drops. See [Offline and at a limit](../care/offline.md).

It's slower and less capable than the big cloud models. Use it for everyday questions and drafts, and a cloud provider for hard jobs.

## Good to know

- **Thinking is off by default,** so small models answer straight away. Turn it up under **Thinking**, in the chip that shows the model and mode.
- **It holds 16,000 to 64,000 tokens of the chat,** sized to the model and this computer's memory.
- **A small model gets a lean setup:** short instructions, and tools as it needs them.
- **Conch keeps Ollama running,** and notes a restart under **Settings → Health → Fixed on its own**.
