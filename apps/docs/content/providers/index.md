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

Open **Settings → Providers**. Each provider is one card with one button.

- **A program on this computer.** Conch finds it where it really lives. If it's missing, **Install** gets it, with the command shown; then **Sign in** runs the program's own sign-in.
- **A key.** Paste it, and Conch checks it before keeping it. "Saved" means it works.

## Where keys live

A key stays on this computer, in a file only you can read, and is never shown again. Or keep it in 1Password: paste a reference (`op://Vault/Item/field`) instead of the key, and Conch asks 1Password for it only when a chat needs it.

## When one can't answer

Offline, or at a usage limit, Conch hands the turn to the provider you chose for that, and says so in one line. See [Offline and at a limit](../care/offline.md).
