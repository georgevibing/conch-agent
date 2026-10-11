---
title: This computer
description: See how the computer running Conch is doing, live, and what Conch and each provider are using.
order: 1.5
---

Conch and its work run on your computer. **Settings → This computer** shows how it's doing, live. Or press <kbd>mod+k</kbd> and type **this computer**, **cpu** or **disk space**.

## At a glance

The top sums it up: **Room to spare**, **Busy right now**, **Working hard**, **Low on memory** or **Battery low**. Under it: the system, processor, memory and how long it has been on.

Then four numbers: processor, memory, the disk Conch keeps your things on, and battery (or the graphics processor, without one).

## The last few minutes

Processor, memory, network and graphics each have a live chart:

- A reading every two seconds, up to three minutes.
- Point at a chart, or drag a finger across it, to read a moment.
- Bars under the processor's chart show each core.

With **Reduce motion** on (**Settings → General**, under **Appearance**), charts redraw in place.

## Conch and what it started

A table shows what Conch uses and everything it started, grouped by owner: each provider's program, the browser, and **Commands and helpers**. A command counts toward the provider that ran it. Ollama counts even if started on its own.

## Use your apps

At the bottom, **Use your apps** lets your assistant see the screen and click and type in apps you allow, on a Mac. Off until you turn it on. See [Use your apps](../features/use-your-apps.md).

## What it reads

Conch looks only while the page is open and in front. It keeps the last three minutes in memory and drops them when you leave.

Numbers only: no file names, commands, addresses or computer name. Nothing needs a password, so some readings depend on the system:

- **Temperature**: Linux, or an NVIDIA graphics card.
- **Battery**: Mac and Linux.
- **Network**, **load** and **Conch and what it started**: not on Windows yet.

When the computer is busy, Conch waits before heavy work. See [Repair everything](./health.md#when-this-computer-is-busy).
