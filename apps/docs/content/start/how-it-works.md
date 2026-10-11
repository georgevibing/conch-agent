---
title: How Conch works
description: A small program on your computer, the app it serves, and the assistants it drives. Conch keeps no copy of your things anywhere else.
order: 4
---

<!-- conch:how -->

## Everything stays on your computer

Your chats, memories, skills and settings are plain files in `~/.conch`. No Conch account, no telemetry.

Two things leave, only when you ask: what you say to your provider, and what your assistant does in an app you connected. With the [model on this computer](../providers/ollama.md), not even that. [Dashboards](../care/dashboards.md) send numbers only where you point them, once you turn them on.

Conch only looks things up, carrying nothing of yours:

- a new version of itself, hourly (every 15 minutes for a copy that follows a branch)
- new versions of its programs, daily
- a few well-known addresses every few minutes, to tell whether you're online

`CONCH_UPDATE_CHECKS=off` stops the version checks.

## The provider answers. Conch does the rest.

A provider brings a model. Conch brings everything around it: [memory](../features/memory.md), [skills](../features/skills.md), [apps](../features/apps.md), [routines](../features/routines.md), the [browser](../features/browser.md). So they work with every provider, and a chat can switch providers and keep its thread.

## It fixes itself

Conch sets itself up. When something is missing, stale or broken, it [repairs it](../care/health.md) and notes it under **Settings → Health → Fixed on its own**. When it can't, you get one plain sentence and the button that fixes it.

It interrupts you only for an approval that matters (spending, sending, deleting, granting trust) or what only a person can do (signing in, typing a password).

## Safe by default

At first, only this computer can open Conch, in a browser Conch opened. Other devices need a passkey or password, over an address only your devices reach. Anything that grants trust takes a person, so your assistant can't give itself more room. [The whole story](../security/signing-in.md).

## Go deeper

[Architecture](../project/architecture.md) describes every part; [Decisions](../project/decisions.md) records why.
