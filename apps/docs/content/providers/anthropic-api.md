---
provider: anthropic-api
---

## Connect it

1. Create a key in the [Anthropic Console](https://console.anthropic.com/settings/keys). It starts with `sk-ant-`.
2. Open **Settings → Providers**, find **Anthropic API** and press **Connect**.
3. Paste the key.

Usage is billed to that Console account, with no subscription and nothing to install.

## What you get

Every Claude model, straight from Anthropic.

Conch runs the chat and supplies the tools: your [apps](../features/apps.md), [memory](../features/memory.md), [skills](../features/skills.md), the [browser](../features/browser.md), files with **Undo** and sealed commands. Anything that changes asks first. Models without tools show **Chat only**. Spend counts toward your [budget](../care/offline.md).

**What it already read costs a tenth.** Conch asks Anthropic to cache the instructions, tools and chat so far. Each step pays full price only for what's new: about four fifths less on a twelve-step job.
