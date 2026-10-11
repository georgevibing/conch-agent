---
title: Providers
description: A provider is what answers. Connect as many as you like, and pick any of their models from one picker.
nav: Overview
order: 1
---

<!-- conch:providers -->

## Every provider at once

Each provider you connect adds its models to one picker, grouped by provider and searchable by name.

- **One is the default.** New chats start there. Change it with **Make default** in **Settings → Providers**, or **Make this my default** in the chip that shows the model and mode.
- **A chat can change provider mid-way.** The new one gets what it missed, word for word: the tools that ran, the browser's page, files changed, an open plan.
- **Ask for one in words.** "Use Opus 5.5" or "something cheaper" switches the chat. See [Ask for another model](../features/chats.md#ask-for-another-model).
- **Each provider carries its own chat on.** Claude Code, Codex, Codex CLI, Copilot, Gemini CLI and Grok pick up where they left off. Others get the whole conversation.
- **What you set up belongs to Conch.** Your [apps](../features/apps.md), [skills](../features/skills.md), [memory](../features/memory.md) and [routines](../features/routines.md) work with every provider. What a provider brings by itself is shown apart.

## What each one can do

A feature a provider can't do is hidden or explained, never broken.

<!-- conch:provider-matrix -->

## Connecting one

Open **Settings → Providers**. Yours are on top, the rest below, sorted by what connecting takes. Search by name or by what it's good at.

- **Coding agents.** Claude Code and Codex CLI bring their own tools and change files in your folders, on a plan you already pay for. Every command and change asks through Conch, as your chat's mode says.
- **Your plans.** Codex, GitHub Copilot, Gemini CLI and Grok use a plan you pay for, through the provider's own program. If it's missing, **Install** gets it and shows the command. You sign in with the program's own sign-in, and Conch never sees its credentials.
- **On this computer.** A model running here, through Ollama or LM Studio, or a [server you run yourself](servers.md).
- **Pay as you go.** Paste a key. Conch checks it first, so "Saved" means it works.
- **Your company's cloud.** [Amazon Bedrock](bedrock.md), [Google Vertex AI](vertex.md) and [Azure OpenAI](azure-openai.md) use the AWS, Google Cloud or Azure sign-in on this computer. Press **Use this** on the account that should pay.

Your Claude Pro or Max plan works through [Claude Code](claude-code.md) only, as Anthropic's terms require. The [Anthropic API](anthropic-api.md) is pay as you go, with a Console key.

Not on the list? [Add any provider](any-provider.md): by name, by address, or from a link.

Each provider opens on its own page. **Providers** at the top goes back to them all. Every place in Settings has its own address, like `/settings/providers`, so reload, bookmarks and the back button work.

## Conch's tools, through your plan

Copilot, Gemini CLI and Grok use Conch's tools, not their own:

- Files in the chat's work folder, sealed commands with no network, memory, the browser and your [apps](../features/apps.md) all go through Conch's approvals, skill limits and **Undo**.
- When the program's own tools would change a file or run a command, Conch declines.
- A chat carries on in the program's own session. Your assistant keeps its name, voice and what it knows about you.
- You see each step in the chat as it happens.

## Use an API key instead

Press **Use an API key instead** at the foot of **Settings → Providers**, or paste a key anywhere on that page.

- **A key only one company uses** (`gsk_` is Groq, `xai-` is xAI) is checked with that provider straight away.
- **A key that could be anyone's**, like a plain `sk-`, makes Conch ask whose it is.
- **A company with regions** (Kimi, Z.ai, MiniMax, Qwen) is tried at each of its own addresses, and Conch remembers the one that worked.

A key is only sent to the company it belongs to.

## Found on this computer

Conch offers what's already here under **Found on this computer**: a key in this computer's settings (`OPENAI_API_KEY`), a model server on its usual port, or an AWS profile or Google Cloud project you're signed in to. Nothing is used until you press it, and a key is never shown.

## Where keys live

A key stays on this computer, in a file only you can read, and is never shown again. Or paste a 1Password reference (`op://Vault/Item/field`), and Conch asks 1Password for it only when a chat needs it.

## When one can't answer

Offline, or at a usage limit, Conch hands the turn to the provider you chose for that, and says so in one line. See [Offline and at a limit](../care/offline.md).
