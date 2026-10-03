---
title: Another server
description: A model server you run yourself, or a service with an OpenAI-compatible address, as a provider of its own.
after: lm-studio
---

<!-- conch:server-facts -->

## Add one

1. Open **Settings → Providers** and choose **Another server**.
2. Type its address: `localhost:8080`, `gpu-box:8000` or an `https://` address. Conch looks at it as you type and says what it found, like “llama.cpp, with 3 models”.
3. Give it a name, and a key if it asks for one. Press **Add server**.

Its models join the picker under the name you gave it. A server already running on this computer, on its usual port, is offered under **Found on this computer**: one press adds it.

## Starting points

The page offers the ones people add most: llama.cpp, vLLM, Jan and LiteLLM on your computer, and Together AI, Fireworks, Hugging Face, NVIDIA and Venice online. Choose one and its address is filled in.

## Good to know

- **Plain http stays at home.** It works on this computer and your own network, including your tailnet. Anywhere else, the address must be `https`, so your key and your chats never cross the internet in the clear.
- **A key goes to that server only,** and is kept like every key in Conch.
- **On this computer means offline too.** A server at `localhost` answers with no internet, and Conch can hand a chat to it when the internet drops.
- **Ollama and LM Studio have their own cards.** If you type their address, Conch sends you there: they can do more through their own cards.
- **A backup names its servers.** Restoring a backup that adds a server shows it first, so an old or borrowed backup can’t quietly send your chats somewhere.
