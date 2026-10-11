---
title: Another server
description: A model server you run yourself, or a service with an OpenAI-compatible address, as a provider of its own.
after: lm-studio
---

<!-- conch:server-facts -->

## Add one

1. Open **Settings → Providers** and choose **Another server**.
2. Type its address: `localhost:8080`, `gpu-box:8000` or an `https://` address. Conch says what it found, like “llama.cpp, with 3 models”.
3. Give it a name, and a key if it asks. Press **Add server**.

A server already running here on its usual port is offered under **Found on this computer**.

## Starting points

Choose llama.cpp, vLLM, Jan or LiteLLM on your computer, or Together AI, Fireworks, Hugging Face, NVIDIA or Venice online, and its address is filled in.

## Good to know

- **Plain http stays at home:** this computer and your own network, tailnet included. Anywhere else needs `https`.
- **A key goes to that server only.**
- **A server at `localhost` answers offline,** and can take over a chat when the internet drops.
- **Ollama and LM Studio here have their own cards,** which do more. Type their address and Conch sends you there. One on another machine is added here.
- **Hugging Face and Venice need their key first** before Conch calls them ready.
- **A backup names its servers.** Restoring one that adds a server shows it first.
