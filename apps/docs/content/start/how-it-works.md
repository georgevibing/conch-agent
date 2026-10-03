---
title: How Conch works
description: A small program on your computer, the app it serves, and the assistants it drives. Conch keeps no copy of your things anywhere else.
order: 4
---

<!-- conch:how -->

## Everything stays on your computer

Your chats, memories, skills and settings are plain files in one folder, `~/.conch`. There is no Conch account and no telemetry.

Two things leave your computer, and only when you ask: what you say to the provider you chose, and what your assistant does in an app you connected. Choose the [model on this computer](../providers/ollama.md), and not even that.

Conch itself only looks things up: once a day it looks for new versions of itself and of the programs it uses (`CONCH_UPDATE_CHECKS=off` stops that), and every few minutes it reaches a few well-known addresses to tell whether you're online. Neither carries anything of yours.

## The provider answers. Conch does the rest.

A provider brings a model. Conch brings everything around it: [memory](../features/memory.md), [skills](../features/skills.md), [apps](../features/apps.md), [routines](../features/routines.md), the [browser](../features/browser.md). That is why they work with every provider, and why a chat can move from one to another without losing its thread.

## It asks only when it matters

Conch is for people who don't debug. It sets itself up. When something is missing, stale or broken, it [repairs it](../care/health.md) and carries on, and tells you afterwards, quietly.

It interrupts you for two things only: an approval that matters (spending, sending, deleting, granting trust), and what only a person can do (signing in, typing a password).

## Safe by default

Out of the box, only this computer can open Conch, in a browser Conch opened itself. Other devices get in after you choose a password, over an address only your own devices can reach. Your assistant can't give itself more room: anything that grants trust takes a person. [The whole story](../security/signing-in.md).

## Go deeper

[Architecture](../project/architecture.md) describes every part, and [Decisions](../project/decisions.md) records why each is the way it is.
