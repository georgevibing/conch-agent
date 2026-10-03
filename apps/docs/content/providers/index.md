---
title: Providers
description: A provider is what answers. Connect as many as you like: Conch drives all of them at once, from one model picker.
nav: Overview
order: 1
---

<!-- conch:providers -->

## Every provider at once

There is no "current provider" to switch. Each one you connect adds its models to the same picker, grouped by provider and searchable by name.

- **One is the default.** New chats start there. Change it with **Make default** in **Settings → Providers**, or from the picker.
- **A chat can change provider mid-way.** The one that joins is handed what it missed, word for word, so the thread carries on.
- **What you set up belongs to Conch.** Your [apps](../features/apps.md), [skills](../features/skills.md), [memory](../features/memory.md) and [routines](../features/routines.md) work with every provider. What a provider brings by itself is shown apart, and says so.

## What each one can do

Providers differ. Conch never pretends otherwise: a feature a provider can't do is hidden or explained, never broken.

<!-- conch:provider-matrix -->

## Connecting one

Open **Settings → Providers**. Yours are on top. The rest wait below as tiles, sorted by what connecting takes, and you can find one by name or by what it's good at.

- **Your plans.** Claude Code, Codex, GitHub Copilot, Gemini CLI and Grok use a plan you already pay for, through the provider's own program on this computer. If it's missing, **Install** gets it, with the command shown; then you sign in with the program's own sign-in. Conch never sees its credentials.
- **On this computer.** A model on this computer, through Ollama or LM Studio, or a [server you run yourself](servers.md).
- **Pay as you go.** Paste a key and Conch checks it before keeping it. "Saved" means it works.

## Have a key? Paste it anywhere

Paste a key anywhere on **Settings → Providers**. When it starts with something only one company uses (`gsk_` is Groq, `xai-` is xAI), Conch knows whose it is and checks it with that provider straight away. Plenty of keys just start `sk-`, and some start with nothing at all; for those, Conch asks whose it is first. A key is only ever sent to the company it belongs to, never tried at several to see which one takes it.

A company with regions (Kimi, Z.ai, MiniMax, Qwen) is tried at each of its own addresses, and Conch remembers the one that took your key.

## Found on this computer

Conch looks for what's already here: a provider's key in this computer's settings (`OPENAI_API_KEY`), or a model server running on its usual port. Each is offered under **Found on this computer**, ready in one press. Nothing is used until you press it, and a key is never shown.

## Where keys live

A key stays on this computer, in a file only you can read, and is never shown again. Or keep it in 1Password: paste a reference (`op://Vault/Item/field`) instead of the key, and Conch asks 1Password for it only when a chat needs it.

## When one can't answer

Offline, or at a usage limit, Conch hands the turn to the provider you chose for that, and says so in one line. See [Offline and at a limit](../care/offline.md).
