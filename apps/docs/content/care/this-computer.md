---
title: This computer
description: See how the computer running Conch is doing, live, and what Conch and each provider are using.
order: 1.5
---

Conch runs on your computer, and so does the work you give it. **Settings → This computer** shows how that computer is doing, as it happens.

Press <kbd>mod+k</kbd> and type **this computer**, **cpu** or **disk space** to go straight there.

## At a glance

The top of the page says how things are in a few words: **Room to spare**, **Busy right now**, **Working hard**, **Low on memory** or **Battery low**. Under it are the computer's system, its processor and memory, and how long it has been on.

Then four numbers: the processor, memory, the disk Conch keeps your things on, and the battery. A computer without a battery shows its graphics processor instead.

## The last few minutes

The processor, memory, network and graphics each have a live chart. New readings arrive every two seconds and the line moves along with them, filling out to three minutes of history. Point at a chart, or drag a finger across it, to read a moment. With **Reduce motion** on, the charts redraw in place instead of moving.

Under the processor's chart, a row of bars shows each core.

## Conch and what it started

A table shows what Conch itself uses, and everything it started, grouped by who it belongs to: each provider's program, the browser, and **Commands and helpers**. A command your assistant runs counts toward the provider that ran it, so you can see which one is busy. Ollama is counted even when it was started on its own.

## What it reads

Conch looks only while the page is open and in front. Leave it, and Conch stops looking soon after. It keeps only the last three minutes, in memory, and lets them go when you leave.

It shows numbers only: no file names, no commands, no addresses and not the computer's name. Nothing needs a password, so a few readings depend on the system:

- **Temperature** shows on Linux and on computers with an NVIDIA graphics card.
- **Battery** shows on a Mac and on Linux.
- **Network**, **load** and **Conch and what it started** aren't shown on Windows yet.

When this computer is busy, Conch already waits before starting heavy work. See [Repair everything](./health.md#when-this-computer-is-busy).
