---
title: How Conch works on a problem
description: When something fails, your agent finds out why, tries another way and checks the result before it says it's done.
nav: Working on a problem
order: 0.6
---

Every [agent](./agents.md) works the same way when something gets in its way. It doesn't give up at the first error.

1. **It finds out why.** It reads the error, looks at what it can, and says what it found.
2. **It tries another way.** A different command, another source, a smaller step. It doesn't repeat what already failed.
3. **It checks.** Before it says something is done, it looks: the file is there, the test passes, the page shows the change.
4. **It asks only for what only you can do.** A sign-in, a choice, a key. One plain sentence, and what it already tried.

It talks you through it in its own voice, and the steps show in the chat as it goes. A long job that's plainly getting nowhere pauses with **Carry on**: see [long jobs](./chats.md#long-jobs). What it may do without asking is up to the chat's [mode](../reference/modes.md), whatever it tries.
