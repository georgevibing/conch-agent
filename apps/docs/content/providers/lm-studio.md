---
provider: lm-studio
---

## Connect it

1. Open **Settings → Providers** and choose **LM Studio**.
2. If it isn’t here, press **Install LM Studio**. Conch uses winget or Homebrew, or links to it on Linux.
3. Download a model in LM Studio. It shows up in the picker.

Conch finds LM Studio's server on whatever port it last used, and starts it if it's off.

## What you get

Your LM Studio models, private, free and offline. Conch asks what each can do (pictures, tools, thinking) and leaves out embedding models. Models that call tools get your [apps](../features/apps.md), [memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md). Anything that changes asks first.

## Good to know

- **A small model gets a lean setup:** short instructions, and tools as it needs them. Load it with a bigger context length in LM Studio, and Conch uses it.
- **The first answer waits** while LM Studio loads the model. Conch says so in the chat.
- **A key, only if you turned one on.** With **Require Authentication** on, create a token under **Developer → Server Settings → Manage Tokens** and paste it on LM Studio’s page in Conch.
- **It answers offline,** and can take over a chat when the internet drops. See [Offline and at a limit](../care/offline.md).
