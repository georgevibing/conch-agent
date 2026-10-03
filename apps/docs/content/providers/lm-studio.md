---
provider: lm-studio
---

## Connect it

1. Open **Settings → Providers** and choose **LM Studio**.
2. If LM Studio isn’t here, press **Install LM Studio**. Conch installs it with winget or Homebrew, or links to it on Linux.
3. Download a model in LM Studio. It shows up in the picker by itself.

Conch finds LM Studio where it keeps itself, and its server on whatever port it last used. If the server is off, Conch starts it and leaves a note under **Fixed on its own**.

## What you get

The models you already have in LM Studio, running on this computer: private, free and offline. Conch reads what each one can do (pictures, tools, thinking) from LM Studio itself, and leaves out embedding models.

Conch runs the conversation itself: it keeps the thread, hands the model the tools of your [apps](../features/apps.md), and asks you before anything changes. [Memory](../features/memory.md), [skills](../features/skills.md) and the [browser](../features/browser.md) all work with models that can call tools.

## Good to know

- **The first answer waits for the model.** LM Studio loads a model when it’s first asked. Conch says so in the chat while it loads.
- **A key, only if you turned one on.** If **Require Authentication** is on in LM Studio, create a token under **Developer → Server Settings → Manage Tokens** and paste it on LM Studio’s page.
- **It answers offline.** When the internet drops, Conch can hand the chat to it. See [Offline and at a limit](../care/offline.md).
